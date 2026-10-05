/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Outer code spike (#1141): `pnpm run bench:outer-code [options]`.
 *
 * Compares the outer codes for Prism with today's LT code through the same seeded erasure channels
 * as `pnpm run bench:transfer`: our own code (`fec`, crates/prism-fec, #1176, in blocks of up to
 * 8192 symbols; `fec-2048` is the same code in blocks of at most 2048) and, when installed, the
 * RaptorQ and Wirehair packages the spike compared. Reports the size of each
 * candidate's WebAssembly and glue, encode and decode time per K, and the reception overhead in
 * symbols beyond K (median, p99, worst). Everything except the times is seeded and repeatable.
 *
 * RaptorQ and Wirehair are NOT dependencies of this repository. Install them in a scratch directory:
 *
 *   mkdir /some/scratch && cd /some/scratch && echo '{"type":"module"}' > package.json
 *   pnpm add raptorq wirehair-wasm
 *   pnpm run bench:outer-code --modules /some/scratch
 *
 * Options:
 *   --modules <dir>      Directory whose node_modules holds the candidates (or OUTER_CODE_MODULES).
 *   --candidates <list>  Comma list of lt, fec, fec-2048, raptorq, wirehair (default: lt, fec, fec-2048
 *                        plus whichever are installed).
 *   --ks <list>          Comma list of K values (default 10,100,1000,8192).
 *   --trials <n>         Trials per cell for every K (default: 1000, 1000, 200, then 5 for LT,
 *                        30 for fec and 100 for fec-2048).
 *   --channels <list>    Comma list of channel names (default clean,join,loss-30,burst).
 *   --determinism        Print the SHA-256 of a seeded symbol stream per candidate (twice).
 *   --chromium <path>    Also run the determinism hash in that Chromium build and compare it with Node.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { FecDecoder, FecEncoder, FountainDecoder, FountainEncoder, loadFecModule } from '../src/packages/optical-transfer/index.ts';
import { createRandom } from '../tests/utils/scannerCorpus.ts';
import { ERASURE_CHANNELS, type ErasureChannel } from '../tests/utils/transferBench.ts';

const SYMBOL_SIZE = 64;
/** A sender never shows more than this many times K before the trial counts as failed. */
const GIVE_UP_FACTOR = 12;
const DETERMINISM_K = 100;
const DETERMINISM_REPAIR = 50;

/** One sender and receiver pair for a single message. */
interface Link {
  /** The bytes of symbol or packet `index` as they would travel in a frame. */
  wire(index: number): Uint8Array;
  /** Builds packet `index` on the sender side; the returned function hands it to the receiver and reports completion. */
  send(index: number): () => boolean;
  recover(): Uint8Array | null;
  dispose(): void;
}

interface Candidate {
  name: string;
  /** What to install, and where its WebAssembly and glue live under node_modules. */
  files: string[];
  open(message: Uint8Array, symbolSize: number, streamLength: number): Promise<Link>;
}

type Loader = (modules: string) => Promise<Candidate>;

interface Args {
  modules: string | undefined;
  candidates: string[] | undefined;
  ks: number[];
  trials: number | undefined;
  channels: string[];
  determinism: boolean;
  chromium: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const read = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const list = (flag: string): string[] | undefined => read(flag)?.split(',').filter(Boolean);
  const trials = read('--trials');
  return {
    modules: read('--modules') ?? process.env.OUTER_CODE_MODULES,
    candidates: list('--candidates'),
    ks: (list('--ks') ?? ['10', '100', '1000', '8192']).map(Number),
    trials: trials === undefined ? undefined : Number(trials),
    channels: list('--channels') ?? ['clean', 'join', 'loss-30', 'burst'],
    determinism: argv.includes('--determinism') || read('--chromium') !== undefined,
    chromium: read('--chromium'),
  };
}

function defaultTrials(candidate: string, k: number): number {
  if (k <= 100) return 1000;
  if (k <= 1000) return 200;
  if (candidate === 'fec') return 30;
  if (candidate === 'fec-2048') return 100;
  return 5;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Imports an ES module by absolute path, the way no bundler or package `exports` map is involved. */
async function importFile(file: string): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (!isRecord(loaded)) throw new Error(`${file} did not load as a module`);
  return loaded;
}

/**
 * Calls a method of an untyped module object. The candidates ship their own types, but they are not
 * dependencies here, so every call goes through this one place and its result is checked by the caller.
 * @param owner - The object or class that has the method.
 * @param method - Its name.
 * @param args - The arguments.
 * @returns Whatever the method returned.
 */
function invoke(owner: unknown, method: string, args: unknown[] = []): unknown {
  if (!isRecord(owner) && typeof owner !== 'function') throw new Error(`Cannot call ${method}: the installed package does not have it`);
  const fn: unknown = Reflect.get(owner, method);
  if (typeof fn !== 'function') throw new Error(`${method} is not a function in the installed package`);
  return Reflect.apply(fn, owner, args);
}

function bytesOf(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error('The installed package returned something other than bytes');
  return value;
}

/** RaptorQ (RFC 6330) through the `raptorq` npm package (the Rust crate's wasm-bindgen build). */
const loadRaptorq: Loader = async (modules) => {
  const dir = path.join(modules, 'node_modules', 'raptorq');
  const mod = await importFile(path.join(dir, 'raptorq.js'));
  invoke(mod, 'initSync', [fs.readFileSync(path.join(dir, 'raptorq_bg.wasm'))]);
  return {
    name: 'raptorq',
    files: [path.join(dir, 'raptorq_bg.wasm'), path.join(dir, 'raptorq.js')],
    async open(message, symbolSize, streamLength) {
      const k = Math.ceil(message.length / symbolSize);
      const encoder = invoke(mod.Encoder, 'with_defaults', [message, symbolSize]);
      // The crate makes a fixed number of repair packets up front: K source packets, then the repairs.
      const made = invoke(encoder, 'encode', [Math.max(0, streamLength - k)]);
      if (!Array.isArray(made)) throw new Error('raptorq Encoder.encode did not return an array');
      const packets = made.map(bytesOf);
      const decoder = invoke(mod.Decoder, 'with_defaults', [BigInt(message.length), symbolSize]);
      let result: Uint8Array | null = null;
      return {
        wire: (index) => packets[index],
        send: (index) => () => {
          const out = invoke(decoder, 'decode', [packets[index]]);
          if (out instanceof Uint8Array) result = out;
          return result !== null;
        },
        recover: () => result,
        dispose: () => {
          invoke(encoder, 'free');
          invoke(decoder, 'free');
        },
      };
    },
  };
};

/** Wirehair through `wirehair-wasm` (the C library compiled to WebAssembly, embedded in its glue). */
const loadWirehair: Loader = async (modules) => {
  const dir = path.join(modules, 'node_modules', 'wirehair-wasm', 'dist');
  const mod = await importFile(path.join(dir, 'wirehair.mjs'));
  const needMore = mod.Wirehair_NeedMore;
  if (typeof needMore !== 'number') throw new Error('wirehair-wasm has no Wirehair_NeedMore');
  return {
    name: 'wirehair',
    files: [path.join(dir, 'wirehair.mjs'), path.join(dir, 'wirehair_core.mjs')],
    async open(message, symbolSize) {
      const encoder = await invoke(mod.WirehairEncoderRaw, 'create');
      const decoder = await invoke(mod.WirehairDecoderRaw, 'create');
      invoke(encoder, 'setMessage', [message, symbolSize]);
      invoke(decoder, 'init', [message.length, symbolSize]);
      let done = false;
      return {
        wire: (index) => bytesOf(invoke(encoder, 'encode', [index])),
        send: (index) => {
          const block = bytesOf(invoke(encoder, 'encode', [index]));
          return () => {
            if (!done) done = invoke(decoder, 'decode', [index, block]) !== needMore;
            return done;
          };
        },
        recover: () => (done ? bytesOf(invoke(decoder, 'recover')) : null),
        dispose: () => {
          invoke(encoder, 'free');
          invoke(decoder, 'free');
        },
      };
    },
  };
};

/** The LT code Prism has today (ADR 0014, ADR 0024), for comparison. */
const loadLt: Loader = async () => ({
  name: 'lt',
  files: [],
  async open(message, symbolSize) {
    const encoder = new FountainEncoder(message, { blockSize: symbolSize });
    const decoder = new FountainDecoder();
    return {
      wire: (index) => new TextEncoder().encode(encoder.dropletStringForIndex(index)),
      send: (index) => {
        const droplet = encoder.getDroplet(encoder.seqForIndex(index));
        return () => {
          decoder.ingest(droplet, droplet.data);
          return decoder.isComplete;
        };
      },
      recover: () => (decoder.isComplete ? decoder.finalize() : null),
      dispose: () => undefined,
    };
  },
});

/**
 * Our outer code (#1176, ADR 0037): the prism-fec module through its TypeScript wrapper.
 * @param name - The candidate's name.
 * @param maxBlockSymbols - Most source symbols per block.
 * @returns The loader.
 */
function fecLoader(name: string, maxBlockSymbols: number): Loader {
  return async () => {
    const module = await loadFecModule();
    return {
      name,
      files: [new URL('../src/wasm/prism-fec.wasm', import.meta.url).pathname],
      async open(message, symbolSize) {
        const encoder = new FecEncoder(module, message, { symbolSize, maxBlockSymbols });
        const decoder = new FecDecoder(module, encoder.layout);
        return {
          wire: (index) => encoder.symbol(index).data,
          send: (index) => {
            const symbol = encoder.symbol(index);
            return () => {
              decoder.add(symbol);
              return decoder.isComplete;
            };
          },
          recover: () => decoder.finalize(),
          dispose: () => undefined,
        };
      },
    };
  };
}

const LOADERS: Record<string, Loader> = {
  lt: loadLt,
  fec: fecLoader('fec', 8192),
  'fec-2048': fecLoader('fec-2048', 2048),
  raptorq: loadRaptorq,
  wirehair: loadWirehair,
};

/** Candidates that live in the scratch directory rather than this repository. */
const INSTALLED = new Set(['raptorq', 'wirehair']);

function makeMessage(k: number, symbolSize: number, random: () => number): Uint8Array {
  const message = new Uint8Array(k * symbolSize - Math.floor(random() * Math.min(symbolSize, 16)));
  for (let i = 0; i < message.length; i++) message[i] = Math.floor(random() * 256);
  return message;
}

interface Trial {
  ok: boolean;
  delivered: number;
  decodeMs: number;
}

/**
 * Sends a seeded message through the channel until the decoder rebuilds it. The channel draws
 * match `runCodecTrial` in tests/utils/transferBench.ts, so the LT rows reproduce its numbers.
 * @param candidate - The code under test.
 * @param k - Number of source symbols.
 * @param channel - The erasure channel.
 * @param seed - Seed for the message and the channel.
 * @returns What it took.
 */
async function runTrial(candidate: Candidate, k: number, channel: ErasureChannel, seed: number): Promise<Trial> {
  const random = createRandom(seed);
  const message = makeMessage(k, SYMBOL_SIZE, random);
  const join = channel.randomJoin ? Math.floor(random() * 2 * k) : 0;
  const link = await candidate.open(message, SYMBOL_SIZE, 5 * k + 32);
  try {
    let index = join;
    let bad = false;
    let delivered = 0;
    let transmitted = 0;
    let decodeMs = 0;
    let complete = false;
    while (!complete && transmitted < GIVE_UP_FACTOR * k && index < 5 * k + 32) {
      const deliver = link.send(index++);
      transmitted += 1;
      if (channel.burst) bad = bad ? random() >= channel.burst.exit : random() < channel.burst.enter;
      const lossChance = bad && channel.burst ? channel.burst.lossInBad : channel.loss;
      if (random() < lossChance) continue;
      delivered += 1;
      const copies = random() < channel.duplicate ? 2 : 1;
      for (let copy = 0; copy < copies; copy++) {
        const started = performance.now();
        complete = deliver();
        decodeMs += performance.now() - started;
      }
    }
    const rebuilt = complete ? link.recover() : null;
    const ok = rebuilt !== null && rebuilt.length === message.length && rebuilt.every((byte, i) => byte === message[i]);
    return { ok, delivered, decodeMs };
  } finally {
    link.dispose();
  }
}

function table(headers: string[], body: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...body.map(line)].join('\n');
}

function sizeRows(candidates: Candidate[]): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [];
  for (const candidate of candidates) {
    if (candidate.files.length === 0) continue;
    const bytes = candidate.files.map((file) => fs.readFileSync(file));
    const raw = bytes.reduce((sum, b) => sum + b.length, 0);
    const gzip = bytes.reduce((sum, b) => sum + gzipSync(b, { level: 9 }).length, 0);
    const brotli = bytes.reduce((sum, b) => sum + brotliCompressSync(b).length, 0);
    rows.push([candidate.name, candidate.files.map((f) => path.basename(f)).join(' + '), raw, gzip, brotli]);
  }
  return rows;
}

async function timeRows(candidates: Candidate[], ks: number[]): Promise<Array<Array<string | number>>> {
  const rows: Array<Array<string | number>> = [];
  const clean = ERASURE_CHANNELS[0];
  for (const candidate of candidates) {
    for (const k of ks) {
      const message = makeMessage(k, SYMBOL_SIZE, createRandom(k));
      // The first pass warms the JIT and the module, so only the second is timed.
      let encodeMs = 0;
      for (let pass = 0; pass < 2; pass++) {
        const started = performance.now();
        const link = await candidate.open(message, SYMBOL_SIZE, 2 * k);
        for (let i = 0; i < 2 * k; i++) link.send(i);
        encodeMs = performance.now() - started;
        link.dispose();
      }
      await runTrial(candidate, k, clean, 4242 + k);
      // Decode with no loss from the first symbol: for the systematic codes this is the cheap path.
      const trial = await runTrial(candidate, k, clean, 4242 + k);
      rows.push([candidate.name, k, `${encodeMs.toFixed(1)} ms`, `${trial.decodeMs.toFixed(1)} ms`, trial.ok ? 'ok' : 'FAILED']);
    }
  }
  return rows;
}

async function overheadRows(candidates: Candidate[], args: Args): Promise<Array<Array<string | number>>> {
  const rows: Array<Array<string | number>> = [];
  const channels = ERASURE_CHANNELS.filter((channel) => args.channels.includes(channel.name));
  for (const candidate of candidates) {
    for (const k of args.ks) {
      for (const channel of channels) {
        const trials = args.trials ?? defaultTrials(candidate.name, k);
        const extra: number[] = [];
        const times: number[] = [];
        let failed = 0;
        for (let t = 0; t < trials; t++) {
          const trial = await runTrial(candidate, k, channel, 1000 + t * 7919 + k);
          if (!trial.ok) {
            failed += 1;
            continue;
          }
          extra.push(trial.delivered - k);
          times.push(trial.decodeMs);
        }
        extra.sort((a, b) => a - b);
        times.sort((a, b) => a - b);
        rows.push([
          candidate.name,
          k,
          channel.name,
          trials,
          failed,
          percentile(extra, 0.5),
          percentile(extra, 0.99),
          extra[extra.length - 1] ?? 0,
          `${percentile(times, 0.5).toFixed(1)} ms`,
        ]);
      }
    }
  }
  return rows;
}

/**
 * Hash of a seeded symbol stream: K source symbols then a fixed number of repair symbols.
 * @param candidate - The code under test.
 * @returns The SHA-256 in hex.
 */
async function streamHash(candidate: Candidate): Promise<string> {
  const message = makeMessage(DETERMINISM_K, SYMBOL_SIZE, createRandom(77));
  const link = await candidate.open(message, SYMBOL_SIZE, DETERMINISM_K + DETERMINISM_REPAIR);
  const hash = createHash('sha256');
  for (let i = 0; i < DETERMINISM_K + DETERMINISM_REPAIR; i++) hash.update(link.wire(i));
  link.dispose();
  return hash.digest('hex');
}

/** The same stream, written in plain JavaScript so a browser can run it. Mirrors `streamHash`. */
const BROWSER_SOURCE = `
(async (base, kind) => {
  const rand = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const T = ${SYMBOL_SIZE}, K = ${DETERMINISM_K}, R = ${DETERMINISM_REPAIR};
  const random = rand(77);
  const message = new Uint8Array(K * T - Math.floor(random() * Math.min(T, 16)));
  for (let i = 0; i < message.length; i++) message[i] = Math.floor(random() * 256);
  const parts = [];
  if (kind === 'raptorq') {
    const mod = await import(base + '/raptorq/raptorq.js');
    mod.initSync(await (await fetch(base + '/raptorq/raptorq_bg.wasm')).arrayBuffer());
    for (const packet of mod.Encoder.with_defaults(message, T).encode(R)) parts.push(packet);
  } else {
    const mod = await import(base + '/wirehair/wirehair.mjs');
    const encoder = await mod.WirehairEncoderRaw.create();
    encoder.setMessage(message, T);
    for (let i = 0; i < K + R; i++) parts.push(encoder.encode(i).slice());
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
})
`;

/**
 * Serves the candidate files on loopback for the browser run. The page needs a real origin for module imports.
 * @param modules - The scratch directory.
 * @returns The server and its base URL.
 */
async function serveCandidates(modules: string): Promise<{ close(): void; base: string }> {
  const roots: Record<string, string> = {
    '/raptorq/': path.join(modules, 'node_modules', 'raptorq'),
    '/wirehair/': path.join(modules, 'node_modules', 'wirehair-wasm', 'dist'),
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const prefix = Object.keys(roots).find((p) => url.pathname.startsWith(p));
    const file = prefix ? path.join(roots[prefix], path.basename(url.pathname)) : '';
    if (!file || !fs.existsSync(file)) {
      response.writeHead(url.pathname === '/' ? 200 : 404, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>bench</title>');
      return;
    }
    const type = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
    response.writeHead(200, { 'content-type': type });
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no loopback port');
  return { close: () => server.close(), base: `http://127.0.0.1:${address.port}` };
}

async function chromiumHashes(executablePath: string, modules: string, kinds: string[]): Promise<Record<string, string>> {
  const { chromium } = await import('@playwright/test');
  const served = await serveCandidates(modules);
  const browser = await chromium.launch({ executablePath });
  const hashes: Record<string, string> = {};
  try {
    const page = await browser.newPage();
    await page.goto(`${served.base}/`);
    for (const kind of kinds) {
      hashes[kind] = await page.evaluate(`${BROWSER_SOURCE}(${JSON.stringify(served.base)}, ${JSON.stringify(kind)})`);
    }
    hashes.userAgent = await page.evaluate('navigator.userAgent');
  } finally {
    await browser.close();
    served.close();
  }
  return hashes;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const wanted = args.candidates ?? ['lt', 'fec', 'fec-2048', 'raptorq', 'wirehair'];
  const candidates: Candidate[] = [];
  for (const name of wanted) {
    const loader = LOADERS[name];
    if (!loader) throw new Error(`Unknown candidate "${name}". Use lt, fec, fec-2048, raptorq or wirehair.`);
    if (INSTALLED.has(name) && !args.modules) {
      if (args.candidates) throw new Error('Pass --modules <dir> (or OUTER_CODE_MODULES) for raptorq and wirehair; see the header of this script.');
      continue;
    }
    candidates.push(await loader(args.modules ?? ''));
  }
  const out: string[] = [];
  out.push('## Size of the WebAssembly and glue (bytes)', '');
  out.push(table(['Candidate', 'Files', 'Raw', 'gzip -9', 'brotli'], sizeRows(candidates)), '');
  out.push(`## Encode and decode time (symbol size ${SYMBOL_SIZE} B, this machine)`, '');
  out.push('Encode builds K source and K repair symbols, including setup. Decode is the receiver\'s total time with no loss.', '');
  out.push(table(['Candidate', 'K', 'Encode', 'Decode', 'Result'], await timeRows(candidates, args.ks)), '');
  out.push('## Reception overhead (symbols beyond K that the decoder needed)', '');
  out.push(
    table(['Candidate', 'K', 'Channel', 'Trials', 'Failed', 'Median', 'p99', 'Worst', 'Decode (median)'], await overheadRows(candidates, args)),
    ''
  );
  console.log(out.join('\n'));

  if (args.determinism) {
    const coded = candidates.filter((c) => c.name !== 'lt');
    console.log('## Determinism (SHA-256 of a seeded symbol stream)\n');
    const node: Record<string, string> = {};
    for (const candidate of coded) {
      const first = await streamHash(candidate);
      const second = await streamHash(candidate);
      node[candidate.name] = first;
      console.log(`${candidate.name}: node run 1 ${first}\n${candidate.name}: node run 2 ${second} (${first === second ? 'identical' : 'DIFFERENT'})`);
    }
    if (args.chromium && args.modules) {
      // Our own module's cross-engine check is e2e/foundry-wasm.spec.ts.
      const installed = coded.filter((c) => INSTALLED.has(c.name));
      const browser = await chromiumHashes(args.chromium, args.modules, installed.map((c) => c.name));
      console.log(`browser: ${browser.userAgent}`);
      for (const candidate of installed) {
        console.log(`${candidate.name}: chromium ${browser[candidate.name]} (${browser[candidate.name] === node[candidate.name] ? 'same as Node' : 'DIFFERENT from Node'})`);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
