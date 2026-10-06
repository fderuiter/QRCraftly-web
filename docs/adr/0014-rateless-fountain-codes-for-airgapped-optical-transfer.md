---
status: accepted
superseded_in_part_by: 0021, 0024, 0041
---

# Rateless Fountain Codes and Multi-Tier Scanning for Air-Gapped Optical Transfer

## Context

Screen-to-camera optical communication (SCC) models the air gap between an electronic display and a camera sensor as an asynchronous packet erasure channel subject to rolling shutter tearing, unsynchronized refresh clocks, ambient reflections, and optical blur. The original carouselled chunking protocol suffered from the coupon collector problem ($O(N \ln N)$ frame latency) and stalled completely whenever the initial handshake frame was dropped or missed.

## Decision

We adopt unidirectional rateless fountain codes (Luby Transform codes over $\text{GF}(2)$, framed as Blockchain Commons Uniform Resources / BC-UR multipart parts) for air-gapped file transfers, with the multi-tier optical detection engine of [ADR 0016](./0016-consolidated-optical-detection-engine.md) on the receiving side. Payloads are compressed with native `CompressionStream('deflate-raw')` before fountain block slicing, and every droplet is self-describing so a receiver can join the stream at any point.

The codec lives inside the optical-transfer deep module ([ADR 0017](./0017-consolidated-air-gapped-optical-transfer-package.md)), under `src/packages/optical-transfer/lib/fountain/`, not in a separate `fountain` package.

## Implementation

As implemented (issues #955, #956, #957 and #958):

- **Degree distribution and mixing** (`soliton.ts`, `encoder.ts`): Robust Soliton distribution ($c = 0.1$, $\delta = 0.05$) with a Mulberry32 PRNG seeded by the sequence number. Sequence numbers $1 \dots K$ are systematic (degree 1), so a loss-free channel completes in exactly $K$ frames. Later droplets XOR a Robust Soliton sample of source blocks. The stream is unbounded; it wraps back to the first repair droplet after `max(16K, 9999)` so the header width, and therefore the QR version, stays constant.
- **Decoding** (`decoder.ts`, `gf2.ts`): belief-propagation peeling handles most droplets in $O(\text{degree})$. When peeling stalls on a stopping set and there are at least as many pending equations as unknown blocks, the decoder runs Gauss-Jordan elimination over $\text{GF}(2)$ (bit-packed coefficient rows) and feeds recovered blocks back into the peeling ripple. Elimination is throttled to about one pass per $U/16$ new equations and skipped above 4,096 unknowns to bound CPU time. The decoder reports the rank of the received system (a lower bound between elimination passes, exactly $K$ on completion).
- **Droplet envelope** (`envelope.ts`, `cbor.ts`, `bytewords.ts`, `crc32.ts`): every droplet is a BC-UR multipart part, `UR:BYTES/<seq>-<K>/<minimal Bytewords>`, whose body is the CBOR array `[seqNum, seqLen, messageLen, checksum, fragment]` (BCR-2020-005) followed by the Bytewords CRC-32 (BCR-2020-012). The string is uppercase so QR encoders use the denser alphanumeric mode. CBOR is a minimal in-repo subset (unsigned integers, byte and text strings, definite arrays); Bytewords and CRC-32 are implemented in-repo, so there are no new runtime dependencies.
- **Session header** (`session.ts`): the fountain message is a CBOR byte string that wraps `[version, fileName, mimeType, fileSize, sha256, compression, payload]`. The SHA-256 of the original file and the compression flag (`0` none, `1` deflate-raw) therefore reach the receiver with the message, and every droplet binds to that message through the BC-UR CRC-32 checksum. Carrying a 32-byte hash in every droplet would cost too much of a V7 symbol.
- **Pre-compression**: `compressForTransfer` keeps deflate-raw output only if it saves at least 5%; otherwise, and for known pre-compressed MIME types (JPEG, PNG, ZIP, video, audio and similar), the payload is sent unchanged with the `none` flag.
- **Density bound**: `resolveFountainSymbolSize` picks the largest symbol, at most 100 bytes, whose worst-case droplet string still fits a version 7 QR code at the selected ECC level (Q, or H when chosen; lower levels are raised to Q). The sender's "Max data per QR" slider lowers that cap further. _Superseded by [ADR 0021](./0021-transfer-density-profiles-and-stream-scanning.md): a transfer density now sets the version bound (7, 9 or 11) and the ECC level._
- **Sender** (`worker-slice.ts`, `client.ts`): `useOpticalSender` defaults to fountain mode. The worker emits droplets until STOP, with no `H|` handshake frame and no carousel restart. The first droplet is still checked for scannability with the sanitized stream style before playback. `PreallocatedFramePool` recycles slots through a free list, so an unbounded stream with a bounded lookahead never grows the buffer.
- **Receiver** (`worker-reassembly.ts`, `reassembler.ts`, `client.ts`): `FountainReassembler` accepts droplets in any order from any point, and switches to a new session after 8 consecutive droplets from a different one. On completion it parses the session header, decompresses with `DecompressionStream('deflate-raw')` and verifies the SHA-256 before the file is offered for download; the hook verifies it again before handing the file to the page's injected `saveFile`. `handshakeRequired` applies only to legacy `F|` chunk frames. The receive page shows droplets received against $K$, decoding rank, scan FPS and an ETA in place of the per-part chunk grid and the Compatibility mode toggle.
- **Legacy compatibility**: `fountainMode: false` keeps the `H|`/`F|` carousel, and the receiver still accepts legacy streams.

## Deviations From the Original Proposal

- **Symbol size versus QR version**: the proposal targeted 64–100 byte symbols in QR versions 4–6. Minimal Bytewords spends two alphanumeric characters (11 bits) per byte, and a version 7 code holds only 125 alphanumeric characters at ECC Q (93 at H). The two goals conflict, so the version ≤ 7 bound takes priority. In practice the symbol is about 30–40 bytes at ECC Q and 10–20 bytes at ECC H. At ECC H, messages above roughly 5 MB cannot meet the bound, and the sender reports an error.
- **BC-UR interoperability**: the part framing, Bytewords and CRC-32 follow the BC-UR specifications, but fragment mixing uses our Robust Soliton + Mulberry32 schedule rather than BC-UR's Xoshiro256** schedule. Third-party BC-UR decoders can parse each part but cannot reassemble a multi-part stream.
- **Compression codec**: only `deflate-raw` is used (not gzip), because it has the smallest framing overhead.
- **Multi-tier scanning**: the `BarcodeDetector` → WASM → `jsQR` pipeline is tracked separately (#920 / ADR 0016) and is not part of this change.
- **Two-tier error correction**: the intra-frame Reed-Solomon tier is the QR code's own ECC (level Q or H). No additional Reed-Solomon layer was added.

## Considered Options

- **Bidirectional Optical ARQ (`optical-data-bridge`)**: rejected. Aligning two cameras and two screens at once is impractical for one person moving a file between a phone and a laptop.
- **Carouselled Sequential/Shuffled Chunking with Handshake (previous default)**: rejected as the default because of coupon collector delays, dense QR codes that are hard to scan, and handshake deadlock on packet loss. It remains available as a legacy mode.
- **Unidirectional Rateless Fountain Codes (BC-UR framing)**: selected. Rateless droplets remove the penalty for dropped frames, allow stateless stream entry, and work over a one-way optical link.

## Consequences

- **Ergonomics & Reliability**: a transfer can begin at any frame without a handshake phase. Dropped frames during autofocus or repositioning do not stall or reset progress; typical reception overhead is 5–35% over $K$.
- **Module Density & Scannability**: every frame is at most QR version 7 ($45 \times 45$ modules), well above the sensor's blur threshold. The price is fewer payload bytes per frame than the old 180-byte chunks. Compression claws some of that back for text-like files.
- **Integrity**: files are delivered only after the SHA-256 in the session header matches. The BC-UR CRC-32 rejects corrupted droplets and messages before that.
- **Performance**: decoding runs in the reassembly Web Worker. Peeling keeps per-droplet cost low; elimination cost is bounded by the throttle and the unknown-count limit.
