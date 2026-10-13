---
status: accepted
---

# Tracked Fiducial Search and High-Rate Optical Modem Profiles

## Context

The optical modem's profiles ([ADR 0028](0028-optical-modem-frame-format.md), [ADR 0030](0030-optical-profile-ladder.md)) have at most 160 x 90 cells, so even the densest fills only a corner of what a 1080p camera resolves, and the simulator puts it at about 84 KB/s at 30 fps. The question behind #1161 is how far the same frame format goes when its grid fills the camera's whole picture.

Two things limited that. First, the receiver's fiducial search labels every pixel of every camera frame. On a 4K frame that is most of the decode time: about 200 to 300 ms of a 300 to 400 ms frame on a desktop CPU, so a receiver could never keep up with the camera. Second, no profile was sized for a 1080p or a 4K camera.

## Decision

- **A tracked search.** Once a receiver has read a frame, the next frame's fiducials are looked for only in a square window around each old centre (`modem_rx_track`, `trackFrame`, the `track` option of `decodeModemFrame`). The window's half side is the old cell size times 4.5 cells (centre to edge of a fiducial) plus 12 cells of movement. Inside it, the search is the same as the whole-image one: Otsu threshold, dark components, the ring test. The ring nearest the old centre wins and the old numbering is kept. Then the header and palette are read exactly as before. On any failure the receiver runs the whole-image search, so tracking can cost a frame's time but never a frame that the full search would have read.
- **The whole-image search is unchanged.** Its results are pinned to the original TypeScript receiver by the module's differential test; only the ring test was moved into a function both searches share.
- **Two high-rate profiles, off the ladder.** `HIGH_RATE_PROFILES` holds P6 Wide (384 x 216 cells, 4 OKLab colours, 160 data and 64 check bytes per block) for a 1080p camera and P7 Ultra (768 x 432 cells, 4 colours, 176 and 48) for a 4K camera. Each is sized so a cell covers about 4 camera pixels when the screen fills five sixths of the picture's width. Four colours, not eight, because in the simulator's typical handheld channel eight colours need about 5 pixels per cell. They are not on the ladder: they need a camera that delivers that resolution and a receiver that tracks, and they have not been measured on a device.
- **A ceiling benchmark.** `pnpm run bench:optical-ceiling` sends a file through these profiles and the outer code ([ADR 0037](0037-prism-outer-code-lt-over-ldpc-precode.md)) with the tracked receiver, and writes [OPTICAL_CEILING.md](../OPTICAL_CEILING.md): goodput, the steady rate, lock-on and decode time per frame.

## Consequences

- In the simulator a locked receiver decodes a 4K frame about 3 times faster (70 to 85 ms against 200 to 250 ms on one desktop thread); the rest is sampling and Reed-Solomon. Keeping up with 60 fps at 4K still needs several threads or the GPU sampler ([ADR 0029](0029-optical-gpu-decode-kernel.md)).
- In the simulator, P7 Ultra on a 4K camera carries a steady 3.7 MB/s (29 Mbit/s) at 60 fps in the studio and typical channels, and a short file completes at 3.3 to 3.7 MB/s; at 30 fps, half that. P6 Wide on a 1080p camera carries about 0.8 MB/s at 60 fps. Neither reads in the poor channel. These are a model's numbers: no phone has run them, and none of them reaches 32 Mbit/s.
- The whole-image search picks the wrong four rings on some large grids, mostly monochrome ones, where random data forms rings of the fiducials' size. Tracking hides this once a receiver has locked on, but lock-on can take several frames. Making the whole-image search robust on large grids was left for later, because it changes results the differential test pins; the amendment below adds a strict search after it instead.
- A frame that moves more than about 12 cells between camera frames falls back to the whole-image search for that frame.

## Amendment: a faster ring search and a strict fallback (#1161)

Two changes to finding a frame, made one after the other so each can be measured on its own.

- **A bucket index for the core search.** The ring test looked for each candidate's core among every dark component in the image. On random data most components are candidates, so the search was quadratic: minutes on a 4K frame of pixel noise. Component centres are now filed in 32-pixel squares, and a candidate looks only in the squares within its reach, plus a pixel. A tie between two equally near cores goes to the lower index, as it did in the full scan. The results are bit for bit the same. A unit test compares the index with the old full scan on 160 random scenes holding more than 200 rings, plus a tie split across two squares. The corpus and the probe goldens are unchanged, and on the held-out set below the build with the index gives the same results, frame for frame, as the build before it.
- **A strict search after the whole-image one.** It runs only when the four rings the whole-image search chose give no header (`frame::acquire`). A frame that search reads is read exactly as before. The strict search checks each candidate cell by cell:
  - it samples the 9 x 9 block through the ring's shape, an affine map from the ring's second moments;
  - it tries 45 angles;
  - it uses the candidate's own threshold, halfway between its darkest and lightest tenth;
  - at most 8 of the 81 cells may disagree with the pattern;
  - the core must read as one of the four fiducials in some quarter turn.

  The stages are listed in `locate_fiducials_strict`'s documentation. In short:

  1. the whole-image search's candidates;
  2. candidates collected by shape alone, without the size test;
  3. cores whose ring merged with its surround;
  4. the same again under a threshold that leaves out the bezel, and under one that splits light cells from grey;
  5. the fourth fiducial looked for where the other three put it.

  Four verified rings whose cores read as the four fiducials in clockwise order skip the area test, because perspective shrinks the far rings along both axes. Any other four must be within 4 times of each other's area. The header's Reed-Solomon code and magic byte stay the final check: a strict quad is used only if its header reads.

- **The probe keeps the whole-image search.** `acquireFrame` takes `{ strict: false }`, and the probe's analysis passes it. With the strict search, probe run 11 (60 Hz luminance flicker, typical channel, 3 px a cell) would read three frames correctly that the recording files as `no-fiducials`. The plan for this change keeps the probe goldens unchanged. Moving the probe onto the strict search is left to the probe's own upgrade, which re-records its goldens on purpose.
- **Acquisition sets.** `src/packages/optical-modem/tests/acquisitionSet.ts` draws positive captures from a development seed and a held-out seed. The positives are the shipped 4-colour profiles (Steady, Wide, Ultra) and the high-rate grids in black and white, with the far edge 15% to 25% shorter than the near one, 2.5 to 3 camera pixels per cell, turned up to 4 degrees, half of them upside down, alternating the studio and typical channels. The set also has negatives of nine kinds. The strict search was tuned on 216 development captures only. `acquisition.test.ts` runs a held-out slice (Steady, Wide and Wide in black and white, with floors), and `acquisitionNegatives.test.ts` runs 216 negatives. `pnpm run bench:optical-finder` runs the full sets and the timings below.

### Results

Acquisition on the held-out set [simulated], 20 captures per profile:

| Profile          | Before | Bucket index only | With the strict search | Readable from the true centres |
| ---------------- | -----: | ----------------: | ---------------------: | -----------------------------: |
| Steady           |   4/20 |              4/20 |                  15/20 |                          18/20 |
| Wide             |   0/20 |              0/20 |                  19/20 |                          19/20 |
| Ultra            |   0/20 |              0/20 |                  18/20 |                          19/20 |
| Shipped 4-colour |   4/60 |              4/60 |          52/60 (86.7%) |                  56/60 (93.3%) |
| Wide, mono       |   0/20 |              0/20 |                  16/20 |                          18/20 |
| Ultra, mono      |   0/20 |              0/20 |                  18/20 |                          20/20 |

The last column reads each capture's header from the fiducials' true centres. No acquired frame was the wrong one, and every acquired frame had all four centres within a cell of the truth.

- **By cell size.** On the shipped 4-colour profiles, 36 of 37 captures acquire at 2.75 to 3 px a cell. At 2.5 to 2.75 px, 16 of 23 acquire. All 14 misses on the held-out set, black and white included, are in the typical channel.
- **The plan's bar of 95% is not met on this set, and no finder could meet it.** 4 of the 8 shipped 4-colour misses cannot be read even from the true centres: at 2.5 px a cell in the typical channel the header itself is marginal. Of the other 4, three found all four rings within a pixel of the truth but their header failed from those centres, and one found only three rings.
- **No false acquisitions.** None in the benchmark's 270 negatives at 960 x 540 and 1920 x 1080, and none in the test's 216.
- **The ceiling benchmark.** In [OPTICAL_CEILING.md](../OPTICAL_CEILING.md), regenerated with this module, P7 Ultra in the poor channel now locks on at the first frame instead of never, though no block decodes there. Every rate is unchanged.

Times on one desktop thread, through the module [measured, sandbox; one run for pixel noise]:

| Capture                               |           Before | Bucket index only |         Strict search added |
| ------------------------------------- | ---------------: | ----------------: | --------------------------: |
| P6 Wide 4-colour, 1080p               |            13 ms |             19 ms |           none (read first) |
| P7 Ultra 4-colour, 4K                 |           170 ms |             58 ms |           none (read first) |
| P7 Ultra mono, 4K                     | 439 ms, not read |   61 ms, not read |          88 ms in all, read |
| P7 Ultra 4-colour, 4K, a fiducial off | 175 ms, not read |   57 ms, not read |     +477 ms (534 ms in all) |
| P7 Ultra mono, 4K, a fiducial off     | 463 ms, not read |   64 ms, not read | +1,230 ms (1,294 ms in all) |
| Pixel noise, 1920 x 1080              |         5,891 ms |             77 ms |                      +54 ms |
| Pixel noise, 3840 x 2160              |       100,461 ms |            299 ms |                     +216 ms |

On P6 the columns differ by run-to-run noise. The lock-on speed-up is the bucket index's. None of this has run on a phone.

- **A frame the whole-image search reads costs nothing more.**
- **A frame nothing reads pays for every stage.** That is about a quarter of a second on 4K pixel noise. The worst case is a frame with three fiducials in view and the fourth out of it, as while a receiver is being aimed (the "fiducial off" rows, `pnpm run bench:optical-finder --only timing`). There the strict search takes about half a second on P7 Ultra and 1.3 s in black and white: about 3 times what the whole-image search took on the same frames before the bucket index. Most of that is the fourth-fiducial search. That stage read 2 of 440 development and held-out captures (44 per profile) that no earlier stage read.
- **A live receiver must budget for it.** It should not run the strict search on every camera frame while it hunts, and it should keep the search off the thread that takes frames, at least until its cost is measured on a phone.
- **The ring check was made faster without changing a result.** In review the check got precomputed turned cells and branch-free counting of disagreements. A unit test compares it with the first version on 16,000 candidates. The 440 captures above, 270 negatives and 30 captures with a fiducial out of view give the same results, bit for bit. The "fiducial off" rows took 719 ms and 2,092 ms before this change.
- **A header that reads stops the search.** When the whole-image search reads a header whose version or constellation this receiver does not know, the frame has been found, so the strict search does not run.

The module grows from about 36 KB to 45 KB gzipped, so its budget in `scripts/check-bundle-size.js` goes from 40 KB to 48 KB.
