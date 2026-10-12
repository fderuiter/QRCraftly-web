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
- The whole-image search picks the wrong four rings on some large grids, mostly monochrome ones, where random data forms rings of the fiducials' size. Tracking hides this once a receiver has locked on, but lock-on can take several frames. Making the whole-image search robust on large grids is left for later, because it changes results the differential test pins.
- A frame that moves more than about 12 cells between camera frames falls back to the whole-image search for that frame.
