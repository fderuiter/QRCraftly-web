---
status: accepted
---

# Prism Manifest Version 2: the Outer Code on the Wire, Opt-In First

## Context

[ADR 0037](./0037-prism-outer-code-lt-over-ldpc-precode.md) built Prism's outer code, an LT code over an LDPC precode decoded by Gaussian elimination, as the Rust module `prism-fec`. It left the wire contract to #1141: a receiver needs the message length, symbol size, seed and block sizes, and each symbol's block and ESI. It also left two limits for #1141 to handle. Every unfinished block reserves its whole matrix, about 9 MB at 8192 symbols, and a round-robin stream keeps every block open until the end.

The code has not yet run on a phone, and the patent write-up for #1174 suggests a short USPTO check before users get it. Every merge to `main` ships to qrcraftly.com.

## Decision

- **Manifest version 2.** A stream sent with the outer code announces manifest version 2 ([ADR 0024](./0024-prism-frame-format.md)): the same 12 positional fields, then a 13th, `blockSymbols`, the most source symbols per block. The receiver rebuilds the layout from fields it already has. The seed is the transfer CRC-32, and the blocks come from `planBlocks(ceil(transferLength / symbolSize), blockSymbols)`. Version 1 still means the LT code.
- **Frame flag.** Every frame of such a stream, manifest and data, sets a new flag bit, `FLAG_OUTER_CODE` (`0b00100`). A receiver from before this change refuses unknown flags and shows its "newer version of the QRCraftly format" message, instead of misreading the stream as LT. A receiver drops any frame whose flag disagrees with its manifest's version.
- **Symbol IDs.** Data frame symbol ID `i + 1` is stream symbol `i`, which belongs to block `i mod B` with ESI `floor(i / B)`, where B is the block count. IDs stay 24 bits and wrap at a multiple of the frame's symbol count, so the frame header does not change.
- **Symbol size.** The outer code takes whole 8-byte words, so the sender rounds the density's symbol size down to a multiple of 8. That is 64, 152 and 224 bytes at the reliable, balanced and fast densities, against 67, 158 and 228 for LT.
- **At most 4 blocks.** A manifest that would need more than `MAX_FEC_BLOCKS` (4) blocks is refused as malformed. The sender sends such a message with the LT code instead, so the outer code covers transfers of up to 2 MB, 4.8 MB and 7 MB after compression at the three densities, and a receiver reserves at most about 50 MB for it. Larger transfers wait for a windowed stream or the back channel ([ADR 0032](./0032-webcam-back-channel.md)) to skip solved blocks.
- **Receiver.** The reassembly worker compiles `prism-fec.wasm` when it starts. Until the module is ready, a version-2 manifest is passed over (it repeats every 16 frames). If it cannot load, the receiver says "This transfer needs a newer browser" once. Progress counts received symbols that raised the rank, leaving out the precode checks a block starts with, so it runs from 0 to K like the LT decoder's.
- **Opt-in first.** The sender keeps the LT code by default. "New transfer format (preview)" under Advanced turns the outer code on. If the module cannot load or the file is too large, the stream goes out with LT and the page says so. The default changes once the phone checks in [the device checklist](../TRANSFER_DEVICE_CHECKLIST.md) and the USPTO check pass.

## Consequences

- With the preview on, a receiver needs a few symbols beyond K where LT needs 5% to 30% more after a join or with loss (`pnpm run bench:transfer`, [the benchmark report](../TRANSFER_BENCHMARK.md)). On a clean channel joined at the start, LT's first K symbols are the source and it needs nothing extra. There the outer code's smaller symbols cost about 2% to 5% more frames.
- A receiver on this release reads both formats. A receiver from before it asks to be updated when it sees a preview stream.
- Issue #1141 asked for a 99th percentile of K + 2. A binary code cannot reach that; the outer code's is K + 6 to K + 9 per block (ADR 0037). It also asked for systematic symbols first, which the design-around rules out.
- The reassembly worker fetches a 6 KB gzipped module on every receive, whichever format the sender uses. The sender fetches it only when the preview is on.
