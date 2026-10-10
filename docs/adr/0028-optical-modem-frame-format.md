---
status: proposed
---

# Optical Modem Frame Format and Reference Codec

## Context

QRCraftly Optical (#1161) sends data as a grid of coloured cells instead of an animated QR code. [ADR 0027](0027-optical-channel-probe.md) measures the channel. This decision fixes what one frame looks like and how a receiver reads it, so that profiles can be added later without breaking receivers already in the field. The reference encoder, decoder and a channel simulator live in `src/packages/optical-modem` and run headless, so every claim here can be tested without a camera.

Nothing here has been run on a phone. Every number below comes from the simulator ([OPTICAL_BENCHMARK](../OPTICAL_BENCHMARK.md)), which is a model. The profile geometries are provisional until the probe has produced device results.

## Decision

### Frame layout

A frame is `cols` x `rows` cells, at least 104 x 40, drawn on white.

- **Fiducials.** Four 9 x 9 blocks in the corners: a dark 7 x 7 ring, a light ring and a 3 x 3 core. The core loses cells fiducial by fiducial (9, 7, 5 and 3 dark cells), which gives the frame its orientation without a fifth marker. The receiver finds them by luma and ranks the cores by area.
- **Calibration strip.** Between the top fiducials, in every frame, there is one 2 x 4 patch for black, one for white and one for each symbol of the constellation. It is repeated in the bottom band. The receiver classifies cells against these patches as seen through its own camera, not against fixed RGB values, so white balance, exposure and screen colour cancel out to first order.
- **Header.** A 42-byte Reed-Solomon codeword (18 message bytes, 24 check bytes, so 12 wrong bytes are repaired), drawn in black and white cells in the top and bottom bands, repeated to fill each strip and read by majority vote. A screen refresh during readout leaves different headers in the two strips; each is tried alone before both together. The header holds: magic byte `0xb7`, version (4 bits), profile (4 bits), constellation id, data bytes per block, check bytes per block, a flags byte (zero today), session id (32 bits), frame sequence (32 bits), columns and rows. The frame size and the inner code are in the header, so a receiver needs no table to read a frame whose profile it has never seen.
- **Data grid.** Every cell between the bands, left to right, top to bottom.

### Constellations

One id byte: bits 0 to 2 are log2 of the symbol count (1 to 4), bit 3 marks the OKLab design. 2, 4, 8 and 16 symbols are defined. The OKLab designs are chosen from a lattice by farthest-point sampling and swaps to maximise the smallest gap in OKLab, with every tie broken by the lowest lattice index, so the same colours come out everywhere. The receiver reads symbol colours from the calibration strip, so the ids only say how many symbols there are and how to draw them.

### Inner code

Reed-Solomon over GF(256) with polynomial `0x11d`, with errors and erasures. Blocks are 164 bytes in the provisional profiles. Within a frame:

- the data is cut into blocks, each block gets a 4-byte tag bound to its identity ([ADR 0043](0043-optical-modem-block-tag.md)) and then its check bytes;
- bytes of different blocks alternate across the grid (byte `i` of block `b` sits at stream position `i * blocks + b`), so a stripe lost to a screen refresh or a reflection costs every block a few bytes instead of one block all of them;
- the stream is XOR-ed with a pseudo-random sequence seeded by session and frame sequence, so large areas never settle on one colour;
- the stream is cut into `log2(symbols)` bits per cell.

The receiver turns each cell into a symbol and a confidence (how far the best colour is ahead of the runner-up, 0 to 255). A byte is **unsure** when a cell it touches has a confidence under 32. For each block, the least sure bytes are given to the code as erasures, up to all the check bytes; if that fails, half, then none. A repair counts only when the block's tag matches; a block with no matching repair is dropped and the outer code asks for more.

Each decoded block is the payload of one rateless droplet of the outer code (the same fountain code the QR transfer uses). The block's position in the stream is `seq * blocks + index`, which is what the outer layer uses as the droplet number, so the outer pipeline is unchanged.

### Soft decoding or hard decoding

The issue asks for soft-decision decoding, or the simpler path with the decision recorded. What is built is **erasure decoding**: the confidence of a cell decides which bytes the code does not trust. That is the cheap end of soft decoding. A soft-decision LDPC decoder uses a probability for every bit and could do better; it was not built.

Measured in the simulator (typical channel, 5 frames, 160-byte blocks, [soft versus hard table](../OPTICAL_BENCHMARK.md#soft-versus-hard-decoding)):

- With each profile's own code, where the margin is wide, erasures make no difference: 100% of blocks are repaired either way at the stressed cell size, except one case of 99% (hard) against 100% (soft) for profile 4.
- With 16 check bytes fewer, near the limit of the code, erasures repair more blocks: 67% against 63% for profile 2, 91% against 89% for profile 3 and 78% against 72% for profile 4.
- Thresholds of 16 and 32 do best. A threshold of 64 or more turns good bytes into erasures, uses up the check bytes and repairs fewer blocks (down to 2% for profile 3).

So erasures give a measured gain of 2 to 6 points of blocks near the limit, never hurt at the chosen threshold, and cost a sort per block. They are kept. A full LDPC code is not chosen for now: its gain over this is unmeasured, it needs a bit-level probability from the colour classifier that this receiver does not yet produce, and Reed-Solomon needs no tables beyond 512 bytes. The decision is open to revisit when the probe shows that real phones lose far more blocks than the simulator does, since erasure decoding gains most when errors cluster. The header's `version` and `flags` fields leave room to introduce another inner code without breaking this one.

### Profiles

Profiles 2 to 4 are provisional. Profile numbers 0 and 1 are reserved for the QR modes of the adaptive ladder and 15 marks probe frames. Cell counts are independent of pixels: the sender picks the cell size that fills its screen, the receiver learns it from the fiducials.

| Profile  | Colours   | Cells (data)        | Block (data + check) | Data per frame | Smallest cell the simulator reads, typical channel |
| -------- | --------- | ------------------- | -------------------- | -------------- | -------------------------------------------------- |
| 2 Steady | 4, OKLab  | 104 x 58 (104 x 40) | 80 + 80              | 480 B          | 3.5 camera px                                      |
| 3 Fast   | 8, OKLab  | 120 x 67 (120 x 49) | 96 + 64              | 1248 B         | 4 camera px                                        |
| 4 Rapid  | 16, OKLab | 160 x 90 (160 x 72) | 80 + 80              | 2800 B         | 5 camera px                                        |

At 30 camera frames per second, one fresh frame per camera frame and no tears, the data rates are 14, 37 and 84 KB/s before the outer code's overhead. Through the outer code, in the simulator, a 48 KB file arrives at about 12, 37 and 69 KB/s. Each block also carries a 4-byte tag ([ADR 0043](0043-optical-modem-block-tag.md)), which the block column leaves out. These are simulator figures at a stated cell size, not device results, and they assume a clean frame every camera frame, which the probe has yet to confirm. The check-byte sweep in the benchmark chose the splits: profile 3 loses only data when it carries more check bytes, while profiles 2 and 4 needed 80 to repair every block at their stressed cell size.

### Versioning

- **The header is the contract.** Its first byte is the magic number, its second the version and profile. The header codeword layout (42 bytes, 18 message bytes) never changes within a major format version. A receiver that reads a header whose version it does not know stops and says so (`unsupported-version`); it does not guess at the grid.
- **Adding a profile does not change the version.** Frame size, constellation and the inner code are all in the header, so a receiver reads any frame whose constellation it knows and whose block fits a Reed-Solomon codeword. A new profile is a new number and a new row in the table; old receivers read it if they know its constellation, and otherwise report `unknown-constellation`.
- **Adding a constellation** takes an id nobody uses. The id format has room for 8 sizes, each in two designs.
- **Changing the header, the fiducials or the calibration strip, or adding another inner code,** is a new version. The block tag of [ADR 0043](0043-optical-modem-block-tag.md) was added within version 1, before any receiver of data frames had shipped. Receivers meeting it report it and offer the QR mode, which the ladder always keeps.
- **The flags byte** is written as zero and ignored on read in this version. A later version can use its bits for optional features, such as a second inner code, because a receiver that does not know a bit still reads the rest.

## Determinism

The encoder and the receiver's sampling path use only integer arithmetic and `+ - * /` on 32-bit floats (`Math.fround`), never `Math.sin`, `Math.pow` or similar, whose last bits differ between engines. The OKLab design uses Newton iterations for cube roots, and the channel simulator uses a Chebyshev recurrence for cosines and a seeded integer generator (mulberry32). A test pins the pixels of one encoded frame by hash. The reference decoder and a later GPU kernel must agree bit for bit on the sampled cell colours.

## Consequences

- The ladder (#1165) selects among profiles 2 to 4 by measured link quality. Each profile's cell size and code are replaced once the probe has measured real phones.
- Frames in this format cannot be read by the QR receiver, and QR frames cannot be read by this one. The modem is entered by a QR handshake (#1161), which is not built here.
- Everything is client-side. Nothing in this format leaves the device.
