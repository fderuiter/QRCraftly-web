---
status: accepted
supersedes: 0026
---

# Prism Outer Code: LT over an LDPC Precode, Decoded by Gaussian Elimination

## Context

Prism ([ADR 0024](./0024-prism-frame-format.md)) still carries files with the LT code from [ADR 0014](./0014-rateless-fountain-codes-for-airgapped-optical-transfer.md). [ADR 0026](./0026-outer-code-selection.md) measured its tail: up to K + 790 symbols at K = 1000, and seconds to decode after a join at K = 10,000. It proposed RaptorQ (RFC 6330), whose overhead is near zero.

Two things changed that plan:

- RaptorQ's patent promise (IETF IPR 2554) excludes devices with cellular radios, so #1176 planned an exact RFC 5053 R10 Raptor code instead, built in Rust.
- The patent check (#1174, 2026-10-05) found that US 9,136,878, active until 2028-01-18, claims R10's systematic construction: the systematic index J(K), its tables, the triple generator and its constants. US 7,721,184 (to 2028-01-27) covers the Gray-code computation of R10's half-weight precode, US 7,412,641 covers subsymbols, and the status of the inactivation-decoding continuation US 9,240,810 could not be confirmed. The base LT, multi-stage (precode plus LT) and inactivation patents have expired.

Fred chose an R10-shaped design-around made only of expired techniques: non-systematic; an LT code with our own degree distribution and generator; a simple LDPC precode with no half-weight stage; hard-erasure decoding by peeling and plain Gaussian elimination, with nothing specific to inactivation; no J(K) and no subsymbols.

## Decision

Prism's outer code is the Rust module `crates/prism-fec` (#1176), compiled to `src/wasm/prism-fec.wasm` ([ADR 0033](./0033-rust-webassembly-modules.md)) and wrapped by `src/packages/optical-transfer/lib/fec/codec.ts`.

- **Precode.** A block of K source symbols gets S = ceil(3K / 100) + 8 parity symbols. Each source symbol joins 3 distinct checks picked by the generator, and each parity symbol is the XOR of its check's sources. That makes L = K + S intermediate symbols.
- **LT layer.** Encoding symbol `esi` (any 32-bit number) is the XOR of d distinct intermediate symbols. The degree d comes from our own table: 38% degree 3, 19% degree 4, 14% degree 6, 12% degree 12, 7% degree 24, 5% degree 48 and 5% degree 64, capped at L / 2. There are no degree 1 or 2 symbols. The decoder is Gaussian elimination, which gains nothing from them, and they are the symbols most often wasted. The few wide symbols cover what the narrow ones miss, which is what brings the overhead down to that of a random binary matrix.
- **Small blocks.** At K of 64 or fewer there is no precode, and each symbol is a uniformly random non-empty subset of the source.
- **Generator.** SplitMix64 (Steele, Lea and Flood, 2014), seeded per symbol from the block's seed and the ESI. Integer maths only, so every engine produces the same symbols.
- **Not systematic.** No encoding symbol is a source symbol. A receiver always decodes.
- **Decoder.** Plain Gaussian elimination over GF(2), done as symbols arrive. Each new symbol is reduced against the stored rows, lowest column first, with its payload. If anything is left it is stored with its lowest column as pivot; otherwise it was redundant. At rank L, back-substitution from the highest column down yields the intermediate symbols, of which the first K are the source. Memory is reserved up front, so adding a symbol never allocates. There is no separate peeling stage. Degree-1 equations are what elimination handles first anyway, and the distribution has none.
- **Blocks.** A block holds at most 8192 symbols (`MAX_FEC_SOURCE_SYMBOLS`) of at most 1024 bytes (`MAX_FEC_SYMBOL_BYTES`), both in `optical-transfer/lib/limits.ts`. The wrapper splits a message into as few blocks as the cap allows, as evenly as possible (`planBlocks`), and sends them round-robin. Each block lives in its own module instance, because the module allocator only reclaims memory once everything in it is freed.
- **Why blocks are as large as allowed.** Elimination grows with the cube of K, so smaller blocks decode faster: a 2048-symbol block takes about 26 ms of work, an 8192-symbol block about 1.1 s. But independent blocks sent round-robin without feedback waste every symbol that reaches a block already solved. Four blocks of 2048 needed a median of 11 extra symbols on a clean channel and 99 with 30% loss, against 1 for one block of 8192 (below). The elimination runs as symbols arrive, so the large block's second of work is spread over the half minute or more it takes to receive 512 KB, and only the last symbol's solve (under 100 ms) is left at the end.
- **Wire contract.** A receiver needs the message length, symbol size, seed and block sizes (`FecLayout`), plus each symbol's block and ESI. #1141 puts these in the Prism manifest and frame header and switches the transfer to this code; until then nothing in the app uses it.

## Evidence

Measured on 2026-10-05 on a shared x86-64 Linux sandbox with Node 22.22.0 and `pnpm run bench:outer-code --determinism`, 64-byte symbols, the seeded channels of ADR 0026 (`clean`, `join` at a random point, `loss-30`, and `burst` at about 13% average loss). Times are in WebAssembly and only good for comparison; overheads are seeded and repeatable. `fec` is the shipped setting (one block up to 8192 symbols); `fec-2048` splits into blocks of at most 2048.

Reception overhead, extra symbols beyond K: median, p99 and worst over the trials.

| Code     | K    | Trials | clean      | join             | loss-30         | burst            |
| -------- | ---- | ------ | ---------- | ---------------- | --------------- | ---------------- |
| LT       | 10   | 1000   | 0, 0, 0    | 1, 5, 5          | 2, 9, 17        | 1, 6, 13         |
| LT       | 100  | 1000   | 0, 0, 0    | 6, 47, 49        | 5, 58, 131      | 6, 48, 77        |
| LT       | 1000 | 200    | 0, 0, 0    | 14, 706, 709     | 13, 324, 462    | 13, 549, 790     |
| LT       | 8192 | 5      | 0, 0, 0    | 1251, 1835, 1835 | 976, 1343, 1343 | 1221, 1731, 1731 |
| fec      | 10   | 1000   | 1, 8, 15   | 1, 7, 12         | 1, 8, 11        | 1, 7, 12         |
| fec      | 100  | 1000   | 1, 8, 10   | 1, 8, 12         | 1, 7, 13        | 1, 7, 10         |
| fec      | 1000 | 200    | 1, 7, 8    | 1, 6, 19         | 1, 6, 9         | 1, 9, 13         |
| fec      | 8192 | 30     | 1, 12, 12  | 1, 6, 6          | 1, 8, 8         | 1, 7, 7          |
| fec-2048 | 8192 | 100    | 11, 37, 39 | 11, 36, 43       | 99, 264, 274    | 46, 102, 104     |

No trial failed. The median is K + 1 in every cell, which is what a uniformly random binary matrix gives; the 99th percentile is K + 6 to K + 9 apart from one cell at 12 among 30 trials. Binary codes fail with about half the probability per extra symbol, so this is the floor without GF(256) rows. The Rust tests (`crates/prism-fec/tests/roundtrip.rs`) check the median and 90th percentile on every build.

Time to decode with no loss, the receiver's total (encode is K source plus K repair symbols, including setup):

| Code     | K    | Encode  | Decode   |
| -------- | ---- | ------- | -------- |
| LT       | 1000 | 5.9 ms  | 3.5 ms   |
| LT       | 8192 | 78.9 ms | 10.3 ms  |
| fec      | 1000 | 1.5 ms  | 4.6 ms   |
| fec      | 8192 | 11.6 ms | 1,053 ms |
| fec-2048 | 8192 | 17.0 ms | 99.9 ms  |

LT is fast here only because its first K symbols are the source; after a join, its median decode at K = 8192 was 636 to 1,080 ms, and it needed 12% to 15% extra symbols. The last symbol's solve for one 8192-symbol block (insert plus back-substitution) took about 80 ms. `pnpm run bench:wasm` times one 2048-symbol block decode after a join at about 26 ms.

The module is 14,068 bytes, 6,387 gzipped. A seeded stream hashes the same on two Node runs, and `e2e/foundry-wasm.spec.ts` checks a fixed battery byte for byte in Chromium, Firefox and WebKit.

## Consequences

- A transfer finishes after K + 1 symbols per block in the median instead of LT's 2% to 20% extra, and there is no long tail.
- The module is about 6 KB gzipped (budget 10 KB in `scripts/check-bundle-size.js`, against the 40 KB #1176 allowed) and has no dependencies.
- Decoding costs more CPU than RaptorQ would, because plain elimination is cubic in K where inactivation decoding is not. That is the price of the design-around. #1176's goal of decoding a whole 8192-symbol block in 50 ms is not met: it is about 1.1 s of work, spread over reception, with about 80 ms left after the last symbol. A phone will be slower; [the device checklist](../TRANSFER_DEVICE_CHECKLIST.md) records it once #1141 wires the code in.
- Every unfinished block holds about L × L bits (8.9 MB at 8192), so #1141 must bound how many blocks a receiver works on at once. Files over 512 KB at 64-byte symbols take several blocks, and a round-robin stream then wastes symbols on solved blocks; #1141 should send blocks in a bounded window, or use the back channel to skip solved ones.
- Before shipping it to users, a 10-minute USPTO Patent Center check of the term and fee status of US 9,136,878, 7,412,641 and 9,240,810 would close the gaps the #1174 check left ([its write-up](https://github.com/fderuiter/QRCraftly-web/issues/1174)).
- If US 9,136,878 lapses (by 2028-01-18 at the latest), a systematic code becomes possible again. Nothing here depends on that.
