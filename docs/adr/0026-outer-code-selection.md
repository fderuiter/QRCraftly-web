---
status: proposed
---

# Outer Code Selection for Prism: RaptorQ

## Context

Prism ([ADR 0024](./0024-prism-frame-format.md)) still uses the Luby Transform (LT) code from [ADR 0014](./0014-rateless-fountain-codes-for-airgapped-optical-transfer.md). Its reception overhead has a long tail. The Prism 3 spike (#1141, part of #1138) asked whether a near-MDS code from WebAssembly would fix that, and which one: RaptorQ ([RFC 6330](https://www.rfc-editor.org/rfc/rfc6330)) or Wirehair. The issue's rule is to default to RaptorQ, because it is a standard and carries several symbols per packet, unless its WebAssembly is over about 150 KB gzipped.

Both candidates were installed from the npm registry in a scratch directory outside the repository, so `package.json` and the lockfile are unchanged, and measured with `pnpm run bench:outer-code` (`scripts/bench_outer_code.ts`). The bench uses the same seeded erasure channels, join points and give-up rule as `pnpm run bench:transfer` ([the benchmark report](../TRANSFER_BENCHMARK.md)), with a 64-byte symbol.

## What can be installed

| Package                  | Version | Licence                                                                    | Browser use                                           | Notes                                                                                                                                                                                    |
| ------------------------ | ------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raptorq`                | 1.7.24  | Apache-2.0                                                                 | yes (wasm-bindgen, ES module)                         | Wasm build of the `cberner/raptorq` Rust crate, RFC 6330. Published by the npm account `pashilka`, which this spike could not tie to the crate's author; last release 2023-06. Measured. |
| `wirehair-wasm`          | 1.0.5   | MIT (upstream Wirehair is BSD-3-Clause; the tarball ships no licence file) | yes (Emscripten, wasm embedded as base64 in the glue) | Single-maintainer wrapper, released 2025-06. Its `install` script clones upstream from GitHub; pnpm does not run it, and the prebuilt `dist/` is what ships. Measured.                   |
| `@raptorqr/raptorq-wasm` | 0.1.1   | MIT wrapper around the same crate at 2.0.1                                 | yes                                                   | Third-party artifact of another project. Size only (below); not run through the channels.                                                                                                |
| `@davidcal/fec-raptorq`  | 1.11.0  | MIT                                                                        | no (Node native wrapper)                              | Not usable in a browser.                                                                                                                                                                 |
| `@blockcast/mmt-fec`     | 0.1.0   | not read                                                                   | n/a                                                   | Does not install: it depends on a local path that was never published.                                                                                                                   |

## Measurements

Measured on a shared x86-64 Linux sandbox with Node 22.22.0 (`pnpm run bench:outer-code`, 64-byte symbols). Times are only good for comparing the candidates with each other and move by a factor of two between runs. Overhead numbers are seeded and repeatable.

### Size

| Candidate                | Files                                              | Raw       | gzip -9       | brotli    |
| ------------------------ | -------------------------------------------------- | --------- | ------------- | --------- |
| `raptorq`                | `raptorq_bg.wasm` (240,516 B) + `raptorq.js`       | 253,359 B | **137,786 B** | 122,908 B |
| `wirehair-wasm`          | `wirehair.mjs` + `wirehair_core.mjs` (wasm inside) | 83,383 B  | **33,510 B**  | 29,041 B  |
| `@raptorqr/raptorq-wasm` | `..._bg.wasm` + glue                               | 209,578 B | 124,101 B     | 113,801 B |

RaptorQ is under the 150 KB line by about 12 KB. The glue files are not minified, which costs about 2 KB.

### Time

Encode builds K source and K repair symbols, including setup. "No loss" decodes from symbol 0 (the systematic path). "After join" is the median over trials that join at a random point, so most symbols are repair symbols.

| Candidate                   | K = 10 | K = 100 | K = 1000 | K = 10000     |
| --------------------------- | ------ | ------- | -------- | ------------- |
| Encode, LT                  | 0.3 ms | 3.6 ms  | 8.6 ms   | 70 ms         |
| Encode, RaptorQ             | 0.4 ms | 1.9 ms  | 8.7 ms   | 123 to 133 ms |
| Encode, Wirehair            | 0.1 ms | 0.2 ms  | 1.7 ms   | 9 to 15 ms    |
| Decode, no loss, LT         | 0.0 ms | 0.4 ms  | 3.9 ms   | 8 ms          |
| Decode, no loss, RaptorQ    | 0.0 ms | 0.2 ms  | 1.1 ms   | 6 to 17 ms    |
| Decode, no loss, Wirehair   | 0.0 ms | 0.1 ms  | 0.6 ms   | 3 ms          |
| Decode after join, LT       | 0.0 ms | 0.7 ms  | 46 ms    | 3,479 ms      |
| Decode after join, RaptorQ  | 0.1 ms | 0.6 ms  | 6.1 ms   | 110 ms        |
| Decode after join, Wirehair | 0.0 ms | 0.1 ms  | 0.7 ms   | 9 ms          |

### Reception overhead

Extra symbols beyond K that the decoder needed, p99 over the trials (worst in brackets where it differs). Channels are those of the transfer bench: `join` is 0% loss with a random join point, `loss-30` is 30% random loss, `burst` is the two-state burst channel (about 13% average loss).

| Candidate | K     | Trials | join  | loss-30   | burst     |
| --------- | ----- | ------ | ----- | --------- | --------- |
| LT        | 10    | 1000   | 5     | 9 (17)    | 6 (13)    |
| LT        | 100   | 1000   | 47    | 58 (131)  | 48 (77)   |
| LT        | 1000  | 200    | 706   | 324 (462) | 549 (790) |
| LT        | 10000 | 5      | n/a   | n/a       | n/a       |
| RaptorQ   | 10    | 1000   | 0     | 0 (1)     | 0         |
| RaptorQ   | 100   | 1000   | 1     | 0 (1)     | 0 (1)     |
| RaptorQ   | 1000  | 200    | 0 (1) | 0         | 0         |
| RaptorQ   | 10000 | 100    | 1     | 0         | 0         |
| Wirehair  | 10    | 1000   | 0     | 0 (1)     | 0 (1)     |
| Wirehair  | 100   | 1000   | 1     | 1         | 1         |
| Wirehair  | 1000  | 200    | 1     | 1         | 1         |
| Wirehair  | 10000 | 100    | 0 (1) | 1         | 1         |

With no loss and no join (`clean`), every candidate decoded K symbols with no overhead. No trial of either candidate failed. The LT code at K = 10000 had only 5 trials (its decode takes seconds), so it has no meaningful p99; its medians were 1,274 to 1,318 extra symbols (about 13% of K) and its worst case 1,945.

Both candidates meet the acceptance criterion (p99 of K + 2 symbols or fewer at 0%, 30% and burst loss) with room to spare: no trial of either needed more than K + 1. The LT code needed up to K + 790 at K = 1000.

### Determinism

The SHA-256 of a seeded stream (K = 100 source symbols and 50 repair symbols, 64 bytes each) is identical across two runs in Node and identical between Node and Chromium 141 (headless, from `/opt/pw-browsers`):

- RaptorQ: `bde12965a070a6bfd9c093808a87c10f65378e22777402aa31a12ea99ee6a87a`
- Wirehair: `b3666411a42664c9e54dcbc7fec9e5d0decbf9f0325cab5acb0624333e6dfe45`

### Network access

In Chromium, loading and running each candidate made no request beyond its own script files (and, for RaptorQ, the `.wasm` file the harness fetched itself). Wirehair's wasm is embedded in its glue. The `raptorq` glue reaches `fetch` only from its default `init()` for a URL or path; `initSync` with bytes or a compiled module never does.

### Not measured

- Decode time on a mid-range phone. Only the x86 sandbox was available.
- Determinism in Firefox and WebKit. Only Chromium is installed here. Both candidates are integer-only WebAssembly, so identical output is expected, but it is not shown.
- Behaviour on the `duplicates` channel (the bench supports it with `--channels`, but it was not run), and the p99 of the LT code at K = 10000.
- Files over one source block (K above 56,403 symbols), and symbol sizes other than 64 bytes.
- RaptorQ's patent position. RFC 6330 is understood to carry IETF IPR disclosures, which were not looked up or reviewed for this project. The Apache-2.0 licence of the code does not settle it.

## Decision

Use **RaptorQ** as Prism's outer code, through the `raptorq` WebAssembly build.

- Its WebAssembly and glue are 137,786 B gzipped, under the 150 KB line in the issue, so the issue's default holds.
- Its reception overhead is at most one symbol in every measured cell, against up to 790 for LT, so the K + 2 criterion is met with room to spare.
- It is a standard (RFC 6330) with an independent Rust implementation, so a future sender or receiver can be built from the specification and the output of the two can be tested against each other.
- Its packets already carry a source block number and a 24-bit symbol ID, which are the two fields of the Prism frame header.

Wirehair is smaller (33.5 KB), faster (about 12 times at K = 10000 after a join) and just as close to the ideal. It is not chosen because it has no specification apart from its C source, a single maintainer of the npm build, a package that ships no licence file and an `install` script that clones from GitHub. It is the fallback if RaptorQ's patent review or its decode time on phones (the 110 ms median at K = 10000 after a join is the number to watch) turns out badly. The two have the same shape of API, so the integration below keeps the codec behind one small interface.

The status is `proposed` because three things the decision depends on were not measurable here: phone decode time, Firefox and WebKit determinism, and the patent review. The integration PR closes the first two with the cross-engine test; the third needs a maintainer.

## Implementation plan

A follow-up PR integrates the codec. This spike changes nothing in `src/`.

1. **Dependency.** `pnpm add raptorq` with the exact version, add it to `ALLOWED_DEPENDENCIES` in `scripts/dependency_compliance.js`, and run `pnpm run licenses:sync` so it is recorded in `scripts/vite/shipped-packages.json` and the third-party licence page. The npm package is not published by the crate's author, so record its integrity hash in the PR and compare its `.wasm` with a build of the same crate version, or build the wasm from the crate and vendor it with its SHA-256 pinned.
2. **Lazy load, no network.** Import `raptorq_bg.wasm` as a build asset (`?url`), never inline it. The reassembly worker fetches it from the site's own origin on first use, compiles it and calls `initSync`; the glue's default `init()` and its `import.meta.url` path are removed at build time, as `scripts/vite/zxingNoNetwork.ts` does for zxing ([ADR 0023](./0023-zxing-wasm-scanner-decoder.md)). Add a test like `tests/zxing_no_network.test.ts` that fails when the glue gains any other network call, and authorise the one same-origin `fetch` in `scripts/bundle_ast_audit.js` by its warning text. `'wasm-unsafe-eval'` is already in `script-src`. Do not precache the file in the service worker.
3. **Budget.** The module stays out of the 260 KB first-load budget. Give it its own line in `scripts/check-bundle-size.js` (150 KB gzipped, the issue's line) and exclude it from the 650 KB JavaScript and CSS ceiling.
4. **Symbol packing.** The symbol size T is fixed per session (32 or 64 bytes, a multiple of 8) and is already in the manifest. K is `ceil(transfer length / T)`. The sender asks for the source symbols and a repair budget from `Encoder.encode`, drops the 4-byte payload ID the crate adds to each packet, and puts n consecutive symbol IDs into each Prism frame (first symbol ID plus count, as in ADR 0024). The receiver rebuilds the 4-byte ID from the block number and symbol ID and calls `Decoder.decode`. Because the binding makes its repair symbols up front, the sender calls `encode` again with a larger budget (the output is a deterministic prefix) when the stream runs past it. Systematic symbols come first. The receiver drops duplicate symbol IDs before calling the decoder.
5. **Large files.** Above 56,403 symbols, the sender splits the file into source blocks and sets the Prism multi-block flag; the receiver streams each block out as it decodes.
6. **Fallback and compatibility.** If WebAssembly is unavailable the receiver says the transfer needs a newer browser, and the sender keeps the LT format under Advanced until it is retired. The frame version or a codec flag tells the receiver which code a stream uses.
7. **Tests and bench.** Add RaptorQ to `pnpm run bench:transfer` (the script here shows how to drive it through the same channels) and to the regression guard. Add the cross-engine test (encode in one Playwright project, decode in another, Chromium, Firefox and WebKit) and record a decode time from a real phone in the device checklist.

To reproduce the numbers in this ADR, install the candidates outside the repository and point the bench at them:

    mkdir /path/to/scratch && cd /path/to/scratch && echo '{"type":"module"}' > package.json
    pnpm add raptorq wirehair-wasm
    pnpm run bench:outer-code --modules /path/to/scratch --determinism

Add `--chromium /path/to/chrome` to compare determinism with a browser, and `--ks`, `--trials` and `--channels` to change the run. `--ks 10000 --trials 100` takes a few minutes.

## Consequences

- A transfer needs about K symbols, not up to 1.7 times K, so the end of a transfer, which is when people give up, stops dragging.
- Frames of different sizes can feed one decoder, because the symbol size no longer follows the size of one QR code.
- First load is unchanged. Receivers download about 123 KB (brotli) or 138 KB (gzip) once, when the transfer page first needs the decoder, and cache it.
- A decode after joining a stream mid-way costs about 110 ms at K = 10000 on this machine, against 9 ms for Wirehair. A phone will be slower. Decoding runs in the reassembly worker, so the page stays responsive, and a frame is only decoded once K symbols have arrived.
- The project takes on a third-party WebAssembly artifact whose provenance and patent position need a recorded review (steps 1 and the patent item above).
- The LT code and its bench stay until the sender's Advanced option is retired.
