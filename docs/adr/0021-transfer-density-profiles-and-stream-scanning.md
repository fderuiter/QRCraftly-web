---
status: accepted
superseded_in_part_by: 0031
---

# Transfer Density Profiles and Stream Scanning

## Context

ADR 0014 bounded every fountain droplet to QR version 7 and let the sender's QR appearance pick the error correction level (Q, or H). An end-to-end check of the optical file transfer (a sender page and a receiver page joined by a synthetic camera in Playwright) found that the transfer was far slower than it needed to be:

- The file-transfer page inherits the generator's appearance, which defaults to ECC H. At H a version 7 code carries about 17 payload bytes, so an 8 KB random file took about 55 seconds.
- The "Max data per QR" slider could only lower that cap, so it had no useful effect.
- The receiver's adaptive frame scheduler backed off to 1 frame per second whenever decodes took 40 to 100 ms, which is normal for dense codes, and never recovered.
- jsQR misses dense codes (version 8 and up) at some module sizes even when the image is sharp, and reads the same frame at a slightly smaller scale.

The fountain code already absorbs lost frames, so per-frame error correction only has to cover blur and glare inside a single frame.

## Decision

- **Density profiles** (`TRANSFER_DENSITY_PROFILES` in `lib/fountain/session.ts`): the sender picks one of three densities, and the density alone sets the droplet's QR version bound and ECC level. The page's appearance ECC no longer applies to fountain streams.

  | Density            | Max QR version | ECC | Use                                   |
  | ------------------ | -------------- | --- | ------------------------------------- |
  | Reliable           | 7              | Q   | Old phones, poor light, long distance |
  | Balanced (default) | 9              | M   | Most phone cameras                    |
  | Fast               | 11             | M   | A steady, close camera                |

  `resolveFountainSymbolSize` accepts ECC L, M, Q or H and QR versions up to 20. `MAX_SYMBOL_SIZE` rises to 400 bytes. `estimateTransferFrames` gives the page a frame and time estimate before the transfer starts. The legacy `F|` carousel keeps its own chunk size and the appearance ECC raised to Q.

- **Multi-scale decode** (`decodeRgbaFrame` in `optical-scanner/lib/decodeSync.ts`): every decode path in the scanner worker tries jsQR dark-on-light at full size, then dark-on-light on a 0.6 box-filtered copy, then both polarities at full size.

  > **Amendment (#1178):** jsQR was replaced by QRCraftly's own decoder (`src/packages/qr-decode`), so the 0.6 copy, a jsQR workaround, is gone; `decodeRgbaCode` makes one call with local thresholds, one global threshold and a half-size pass, each in both polarities.

- **Scheduler recovery** (`AdaptiveFrameScheduler`): when the median decode latency is below the current sampling delay, the delay moves halfway towards it, so a stream that settles at 40 to 100 ms per decode speeds up again. The transfer receiver also caps its sampling delay at 150 ms.
- **Receiver recovery**: fountain droplets are accepted after an error, and the next fountain progress clears it. The camera engine skips a video element until it has a frame (`readyState` 2 or more).
- **Receiver UX**: a blocked, missing or busy camera gets a plain explanation and a "Use a video file instead" action. The completion panel shows the file name, size and SHA-256, and a "Receive another file" action.

## Consequences

- Measured in Chromium with the synthetic camera, a 12 KB random file transfers in about 40 s (Reliable), 13 s (Balanced) and 9 s (Fast), where it previously took about 80 s. All three succeed with the code at half size, 1 px blur, half brightness and 70% contrast.
- Balanced and Fast codes are denser than ADR 0014's version 7 bound. Users with weak cameras choose Reliable, which keeps the old bound at ECC Q.
- `e2e/file-transfer.spec.ts` drives the real sender and receiver through the synthetic camera (`e2e/utils/opticalLink.ts`) and compares the downloaded file byte for byte. It runs in Chromium only; the protocol is covered by the unit suites in every browser project.
