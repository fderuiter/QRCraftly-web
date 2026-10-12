---
status: accepted
---

# Receiver-Only Recovery of Torn Optical Modem Captures

## Context

A phone camera reads its sensor row by row. When the screen changes frame during that readout, the rows above one camera row show frame `n` and the rows below it show frame `n + 1`: the capture is torn. At 60 frames per second on a 60 Hz screen, without control over the camera's timing (a browser has none), the tear sits at a slowly drifting row for seconds at a time.

The frame format ([ADR 0028](0028-optical-modem-frame-format.md)) spreads the bytes of every Reed-Solomon block across the whole grid, so a stripe lost to glare costs each block a few bytes. A tear is not a lost stripe. The wrong half is a valid frame, so its cells come back with high confidence and reach the code as errors, not erasures. Every block has bytes in almost exactly the same rows, so they all fail together. In the simulator, P6 Wide on a 1080p camera in the studio channel decoded 0 of 83 blocks whenever the tear fell between 0.5 and 0.75 of the camera's height **[simulated]**. The header is written in a top strip and a bottom strip, and the receiver already read each strip alone before both together, but it kept only the first header that decoded.

The research for #1161 (`desync-unmixing.md` and `focus-ofdm.md` in the 2026-10-12 "beat LIZARD" folder) found that erasing the torn rows by hand, with an oracle, brings a tear covering up to about 28% of P6's rows back to 83 of 83 blocks. That stays true with today's interleave, so no format change is needed for it.

## Decision

The receiver recovers torn captures by itself. The frame format, version and profiles do not change.

- **Both header strips are reported.** After the frame's header has been read from the top strip alone, the bottom strip is read alone too. Each strip's sequence is reported when the strip decodes alone into the same header apart from `seq` (`modem_rx_acquire` writes them to `io[69]` and `io[70]`; `AcquiredFrame.strips`). The header the receiver uses is chosen exactly as before.
- **A cut across the camera's rows.** When the plain decode leaves blocks unrepaired and the strips do not agree, `modem_rx_decode_torn` splits the data cells at a cut along the camera's rows. The cells above the cut are decoded against the top frame's sequence and the cells below it against the bottom frame's, with every byte from the other side erased. Erased bytes are given confidence 0, so they are the first erasures the decoder spends. The cut is a line of constant camera row (or, for an image the browser turned, camera column): of the two, it is the one the grid's rows run along. Positions are scaled so that the top strip's centre is at row 7 and the bottom strip's at `rows - 2`.
- **The cut is found by trial.** For each side, 65 cuts from just above the first data row to just below the last are tried on two trial blocks, the first and the last. Every block has bytes in nearly the same rows, so two blocks stand for all. Each try is one Reed-Solomon attempt that spends up to every check byte on erasures. A block with more erased bytes than check bytes is not tried. The side is then decoded in full at the middle of the longest run of cuts at which both trial blocks decoded. With no such run, the side gives nothing.
- **Sequence guesses when a strip is unreadable.** When only one strip decodes alone, a tear may run through the other strip. Its side is tried as `seq + 1`, then `seq - 1`. When neither strip decodes alone, both arrangements are tried. When the strips agree, nothing is tried, and the capture decodes exactly as before. The first pair of sequences that gives any block ends the search. A wrong guess or a wrong cut gives no block, because the tag ([ADR 0043](0043-optical-modem-block-tag.md)) binds session, sequence and index.
- **Two captures finish a frame torn near the middle.** A side holding less than about 72% of a frame's rows (P6's 64 check bytes of 228) cannot decode from one capture. The next capture, at nearly the same phase, shows the same frame on the other side of the tear. The decode therefore returns a `carry`: the later frame's sampled cells and the capture's homography, kept only while that frame is incomplete. Passed back as the next decode's `carry` option, it fills in the bytes the current capture shows from another frame. The same cut is used for both captures, which assumes the phase moves little between consecutive captures. The cells are matched in grid coordinates, so camera movement between the captures does not matter. A carry is used only for the same session, frame shape and sequence.
- **The result names each frame.** Blocks of the header's frame fill in `blocks`, `blocksOk`, `erasures` and `corrected` as before. Blocks of the other frame come back in `others`, each list under its own `seq`, so the outer code numbers them correctly. `tear` reports what each strip gave, the pair of sequences, the cuts, the blocks each side added, the pairs tried and the tag's refusals in each side's full decode. `refused` still counts the plain decode alone. `tears: false` turns the recovery off.

## Consequences

All figures are from the channel simulator or this sandbox's CPU. None has been measured on a phone or with a real screen.

- **P6 Wide, 1080p, studio channel, horizontal tear [simulated]:**
  - one capture torn at 0.70 or 0.75 of the camera's height: 83 of 83 blocks, against 0 before;
  - torn at 0.15 to 0.30: the next frame's 83 of 83 blocks come back under its own sequence;
  - torn at 0.40 to 0.65: one capture alone gives nothing, but in a run of captures at a fixed phase every frame after the first is complete (83 of 83), each from the bottom of one capture and the top of the next;
  - in the typical handheld channel, a run of captures gave every frame after the first in full at tears from 0.20 to 0.80; a single capture torn at 0.75 gave 82 of 83 blocks.
- **P7 Ultra, 4K, studio [simulated]:** 348 of 348 blocks from one capture torn at 0.75 (0 before), and every frame after the first in a run torn at 0.55.
- **No wrong block** was accepted in any of these runs, and the tests assert it.
- **The module's simulation corpus gains 17 blocks** (779 to 796): the top half of profile 2's frame torn at half height, which its 80 check bytes per 164-byte block can rebuild. Nothing else in the corpus changes, and captures whose strips agree decode exactly as before.
- **Cost [measured, sandbox, one desktop core, Node and wasm].** A tracked P6 decode takes about 19 ms. On a torn capture it takes 20 to 26 ms with the recovery; on a clean capture the time does not change. A tracked P7 decode goes from about 70 ms to 74 to 92 ms on a torn capture. A carry holds 2 bytes per data cell: 152 KB for P6 and 636 KB for P7.
- **More tag checks per torn capture.** One pair of sequences costs at most 2 sides × 65 cuts × 2 trial blocks of 1 check, plus 3 per block for the full decode: about 760 checks for P6 and 2,350 for P7, against at most 3 per block for the plain decode. Up to four pairs are tried when no strip decodes alone. At about one chance in four billion per check, that is at worst about 2 × 10⁻⁶ wrong blocks per P7 capture. A wrong block would still fail the file's final SHA-256 ([PROTOCOL](../optical-transfer/PROTOCOL.md)); it cannot silently corrupt the file.
- **Limits:**
  - The cut is straight and follows the camera's rows or columns. A portrait phone facing a landscape screen tears along a diagonal. The simulator cannot draw that yet (build plan item 3), and this receiver does not search for it.
  - A blend, where both frames are mixed in the same rows rather than split between rows, is not a tear, and this does nothing for it (build plan item 7).
  - The carry needs consecutive captures. A receiver that skips frames keeps only what one capture gives.
  - A tear across the middle 40 to 60% of rows still costs the first frame of a run. Confining blocks to row bands would avoid that, but it is a format change (ADR 0028), left until devices show how often tears happen.
