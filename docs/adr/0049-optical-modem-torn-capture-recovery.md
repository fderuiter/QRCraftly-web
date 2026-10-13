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
- **Sequence guesses when a strip is unreadable.** When only one strip decodes alone, a tear may run through the other strip. A camera that reads its rows from the top shows the earlier frame above the tear, so the bottom side is tried as `seq + 1` before `seq - 1`, and the top side as `seq - 1` before `seq + 1`. When neither strip decodes alone, both arrangements are tried. When the strips agree, nothing is tried, and the capture decodes exactly as before. The first pair of sequences that gives any block ends the search. A wrong guess or a wrong cut gives no block, because the tag ([ADR 0043](0043-optical-modem-block-tag.md)) binds session, sequence and index.
- **Two captures finish a frame torn near the middle.** A side holding less than about 72% of a frame's rows (P6's 64 check bytes of 228) cannot decode from one capture. The next capture, at nearly the same phase, shows the same frame on the other side of the tear. The decode therefore returns a `carry`: the later frame's sampled cells and the capture's homography, kept only while that frame is incomplete and only when both frames are known to be in the capture, by the header, by their own strip or by blocks of their side. A guessed sequence that gave no block may name no frame of the capture at all; carried under that sequence, its cells would put confident errors where the next capture's decode would otherwise have erasures, and cost it a frame it could decode alone. Passed back as the next decode's `carry` option, it fills in the bytes the current capture shows from another frame. The same cut is used for both captures, which assumes the phase moves little between consecutive captures. The cells are matched in grid coordinates, so camera movement between the captures does not matter. A carry is used only for the same session, frame shape and sequence.
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
  - The cut is straight and follows the camera's rows or columns. A portrait phone facing a landscape screen tears along a diagonal. The amendment below adds slanted cuts.
  - A blend, where both frames are mixed in the same rows rather than split between rows, is not a tear, and this does nothing for it (build plan item 7).
  - The carry needs consecutive captures. A receiver that skips frames keeps only what one capture gives.
  - A tear across the middle 40 to 60% of rows still costs the first frame of a run. Confining blocks to row bands would avoid that, but it is a format change (ADR 0028), left until devices show how often tears happen.

## Amendment: slanted cuts for a phone turned against the screen

A phone held upright in front of a landscape screen reads its sensor across the screen's rows. The refresh line then crosses the picture on a slant, not along a camera row, and no straight cut separates the two frames. The simulator draws this with `tearSlope` (camera rows the tear drops per camera column). With a slope of 0.5, about what a 16 ms readout gives when the screen fills the picture, the receiver above read nothing from P6 Wide in the studio channel at any tear position, and nothing from Ultra Mono in the guessed phone channel **[simulated]**.

### Decision

The receiver also tries cuts slanted against the camera's rows. The frame format does not change.

- **Straight first.** Both sides are cut straight, exactly as before. When a straight cut repairs every block of either side, the tear is straight, and nothing else is tried. A capture whose tear is straight costs what it did, apart from the first capture of a run torn near the middle, which no straight cut finishes alone.
- **Then 12 slants.** Each side that is not finished tries slants of 10 to 60 degrees from the camera's rows, either way, in steps of 10. Positions are measured along the slanted cut's normal, at the same scale as the straight cut's rows, and cuts are tried at the straight search's step across every cell, up to 256 of them. A slant is first tried at every fourth cut, and at every cut only if one of those decodes the trial blocks. The side takes the slant with the longest run of cuts at which both trial blocks decode, and keeps its blocks only if they outnumber the straight cut's.
- **The carry is cut at the same slant.** An earlier capture's cells are placed at the slant being tried, so a frame torn on a slant is finished by the next capture as a straight one was.
- **The report names the slant.** `TearReport.slants` gives each side's slant in degrees; 0 is a straight cut.

### Consequences

All figures are from the channel simulator or this sandbox's CPU. None has been measured on a phone.

- **P6 Wide, 1080p, studio channel, runs of four captures at a fixed tear position from 0.2 to 0.8 [simulated]:** at slopes of 0.3, 0.5 and -0.5, every frame after the first came back whole (one frame at slope 0.3 lacked 1 of 83 blocks). Before, slope 0.5 gave nothing and slope 0.3 gave 0 to 25% of blocks between 0.35 and 0.65. At slope 1 (45 degrees), tears at 0.35 to 0.65 come back whole and tears at 0.2 and 0.8 give nothing.
- **Guessed phone channel, drifting tear at slope 0.5 [simulated]:**
  - Ultra Mono on a 4K camera: 87.5% of blocks, a steady 1.61 MB/s at 60 fps, against 0 before. The file finished in 8 camera frames. With a straight tear the same channel gives 91.7%, 1.68 MB/s ([OPTICAL_CEILING.md](../OPTICAL_CEILING.md)).
  - P6 Wide in 4 colours on a 1080p camera: 17.9% of blocks, against 0. That profile loses most of its blocks to the phone's colour noise reduction anyway.
- **No wrong block** was accepted in any of these runs or in the unit tests. A review harness compared 12,960 synthetic sides with the build before: every side the old receiver finished came back identical, and none lost a block.
- **Cost [measured, sandbox, one desktop core, Node and wasm, tracked decode of one studio capture].** When no straight cut finishes either side: P6 from about 19 to 32 ms, Ultra Mono from about 81 to 106 ms, P7 from about 74 to 93 ms. When a straight cut finishes a side, the time does not change. An undecodable side costs about six times what it did.
- **Size.** The module grows from about 47.4 to 49 KB gzipped, so its budget in `scripts/check-bundle-size.js` goes from 48 to 52 KB. It loads only for file transfer.
- **More tag checks.** At worst each slant tries 320 cuts on two trial blocks, so one pair of sequences costs up to about 15,000 checks, and up to four pairs are tried. At one chance in four billion per check, that is at worst about 1.5 × 10⁻⁵ wrong blocks per capture that no straight cut finishes, still caught by the file's SHA-256.
- **Limits:**
  - Steep slants near the picture's edge fail: at slope 1, tears at 0.2 and 0.8 give nothing.
  - The coarse first pass skips a slant whose run of decoding cuts is narrower than four steps. In the review harness that cost about 4% of the blocks trying every cut would have found.
  - The cut is a straight line. Lens distortion bends a real tear, and a readout longer than a refresh shows three frames; neither is modelled.
  - The slant is assumed the same in consecutive captures, as the cut's position already was.
