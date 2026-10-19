#!/usr/bin/env node
// Headless-Chromium driver for QRCraftly (agent tooling, not product code).
// Reads one command per line from stdin, so it works piped (heredoc) or under tmux.
// Run from the repo root so `@playwright/test` resolves from node_modules:
//   node .claude/skills/run-qrcraftly/driver.mjs <<'EOF'
//   nav /
//   screenshot home
//   EOF
// Type `help` for the command list. Exits non-zero if any command failed.

import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const BASE = process.env.QRC_BASE_URL || 'http://127.0.0.1:3000';
const OUT = resolve(process.env.QRC_OUT || '/tmp/qrcraftly-shots');
// The Chromium shipped in the container is older than the build this
// Playwright version wants, so point at it explicitly when it exists.
const EXE = process.env.QRC_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// Chromium has showSaveFilePicker, so Download would open a native dialog that
// never resolves headless. Without it the app falls back to an <a download>.
await context.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));
const page = await context.newPage();
const logs = [];
const hook = (p) => {
  p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
};
hook(page);

/** `role=button:Download PNG`, `label=Website URL`, `testid=qr-stage`, `text=Foo`, or a CSS selector. */
function loc(sel) {
  const m = /^(role|label|testid|text|placeholder)=(.*)$/s.exec(sel);
  if (!m) return page.locator(sel).first();
  const [, kind, rest] = m;
  if (kind === 'role') {
    const i = rest.indexOf(':');
    return i < 0 ? page.getByRole(rest).first() : page.getByRole(rest.slice(0, i), { name: rest.slice(i + 1) }).first();
  }
  if (kind === 'label') return page.getByLabel(rest).first();
  if (kind === 'testid') return page.getByTestId(rest).first();
  if (kind === 'placeholder') return page.getByPlaceholder(rest).first();
  return page.getByText(rest).first();
}

/** Splits `<selector> <value>` where the selector may contain spaces after `=`; use ` | ` to separate. */
function splitArg(args) {
  const i = args.indexOf(' | ');
  if (i >= 0) return [args.slice(0, i), args.slice(i + 3)];
  const j = args.indexOf(' ');
  return j < 0 ? [args, ''] : [args.slice(0, j), args.slice(j + 1)];
}

let shot = 0;
let lastDownload = '';
const commands = {
  help: () =>
    console.log(`commands:
  nav <path|url>            go to BASE+path and wait for hydration (main[data-hydrated=true])
  viewport <w> <h>          resize (e.g. 390 844 for a phone)
  wait-for <sel>            wait until visible
  wait-text <sel> | <text>  wait until the element's text contains <text>
  click <sel>               click
  fill <sel> | <text>       fill an input (React-safe)
  press <key>               keyboard press (Enter, Tab, ...)
  upload <sel> | <file>     set a file input (<file> = @last for the last download)
  download <sel>            click and save the download into OUT; prints its path
  screenshot [name]         full viewport PNG into OUT
  shot-el <sel> | [name]    screenshot one element
  text <sel>                print innerText
  attr <sel> | <name>       print an attribute
  count <sel>               print how many elements match (CSS or role=...)
  eval <js>                 evaluate in the page, print JSON result
  console [--errors]        print captured console lines (errors/pageerrors only with --errors)
  sleep <ms>                fixed wait (prefer wait-for)
  quit                      close the browser
selectors: role=<role>:<name> | label=<text> | testid=<id> | text=<text> | placeholder=<text> | CSS
env: QRC_BASE_URL (default ${BASE}), QRC_OUT (default ${OUT}), QRC_CHROMIUM`),
  nav: async (a) => {
    await page.goto(/^https?:/.test(a) ? a : BASE + (a || '/'));
    await page.waitForSelector('main[data-hydrated="true"]', { timeout: 30000 }).catch(() => console.log('  (no main[data-hydrated] within 30s)'));
    console.log(`  at ${page.url()} — "${await page.title()}"`);
  },
  viewport: async (a) => {
    const [w, h] = a.split(/\s+/).map(Number);
    await page.setViewportSize({ width: w, height: h });
  },
  'wait-for': async (a) => loc(a).waitFor({ state: 'visible', timeout: 15000 }),
  'wait-text': async (a) => {
    const [s, t] = splitArg(a);
    // Poll through the locator: React re-renders replace the node, so an element handle goes stale.
    const end = Date.now() + 20000;
    let seen = '';
    while (Date.now() < end) {
      seen = await loc(s).innerText({ timeout: 2000 }).catch(() => seen);
      if (seen.includes(t)) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`text never contained ${JSON.stringify(t)}; last saw ${JSON.stringify(seen)}`);
  },
  click: async (a) => loc(a).click(),
  fill: async (a) => {
    const [s, v] = splitArg(a);
    await loc(s).fill(v);
  },
  press: async (a) => page.keyboard.press(a),
  upload: async (a) => {
    const [s, f] = splitArg(a);
    await loc(s).setInputFiles(f === '@last' ? lastDownload : resolve(f));
  },
  download: async (a) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), loc(a).click()]);
    const p = join(OUT, d.suggestedFilename());
    await d.saveAs(p);
    lastDownload = p;
    console.log(`  saved ${p}`);
  },
  screenshot: async (a) => {
    const p = join(OUT, `${String(++shot).padStart(2, '0')}-${a || 'shot'}.png`);
    await page.screenshot({ path: p });
    console.log(`  ${p}`);
  },
  'shot-el': async (a) => {
    const [s, n] = splitArg(a);
    const p = join(OUT, `${String(++shot).padStart(2, '0')}-${n || 'element'}.png`);
    await loc(s).screenshot({ path: p });
    console.log(`  ${p}`);
  },
  text: async (a) => console.log(`  ${JSON.stringify(await loc(a).innerText({ timeout: 15000 }))}`),
  attr: async (a) => {
    const [s, n] = splitArg(a);
    console.log(`  ${JSON.stringify(await loc(s).getAttribute(n))}`);
  },
  count: async (a) => {
    const m = /^role=([^:]+):?(.*)$/.exec(a);
    const l = m ? page.getByRole(m[1], m[2] ? { name: m[2] } : {}) : page.locator(a);
    console.log(`  ${await l.count()}`);
  },
  eval: async (a) => console.log(`  ${JSON.stringify(await page.evaluate(a))}`),
  console: async (a) => {
    const lines = a === '--errors' ? logs.filter((l) => /^\[(error|pageerror)\]/.test(l)) : logs;
    console.log(lines.length ? lines.map((l) => `  ${l}`).join('\n') : '  (none)');
  },
  sleep: async (a) => page.waitForTimeout(Number(a)),
};

let failed = 0;
const rl = createInterface({ input: process.stdin, terminal: false });
for await (const raw of rl) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const sp = line.indexOf(' ');
  const cmd = sp < 0 ? line : line.slice(0, sp);
  const arg = sp < 0 ? '' : line.slice(sp + 1).trim();
  if (cmd === 'quit' || cmd === 'exit') break;
  console.log(`> ${line}`);
  const fn = commands[cmd];
  if (!fn) {
    console.log(`  unknown command "${cmd}" (try help)`);
    failed++;
    continue;
  }
  try {
    await fn(arg);
  } catch (e) {
    failed++;
    console.log(`  ERROR: ${String(e.message).split('\n')[0]}`);
  }
}
await browser.close();
console.log(failed ? `done, ${failed} command(s) failed` : 'done');
process.exit(failed ? 1 : 0);
