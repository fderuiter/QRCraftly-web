---
status: proposed
---

# Optical Channel Probe

## Context

QRCraftly Optical (#1161) replaces the animated QR code with a colour modem: a grid of coloured cells, found by corner markers and calibrated by a strip of reference colours in every frame. The frame geometry (cell size, number of colours, grid size) depends on what a phone camera can resolve through the browser. Nothing published says: Cimbar reached about 106 KB/s on a 2017 phone with its own native code, and PixNet needed custom hardware.

So the first step is to measure. The modem's frame format (#1163) is provisional until the numbers are in.

## Decision

A probe measures the channel on real phones, and its analysis is tested on a simulated channel first.

- **The sender** plays a fixed sequence of 49 patterns: cell pitches of 8, 6, 5, 4, 3 and 2 device pixels, each in black and white and in 4, 8 and 16 colours (spaced in raw RGB and in OKLab), then a slanted edge and, only after an explicit confirmation, flicker patterns at 30, 60 and 120 Hz. Every frame has four corner markers, a calibration strip and a header that names the pattern and counts display frames. Even and odd frames carry different data, so the receiver can tell a clean frame from a blend or a tear of two.
- **The receiver** opens the camera at `ideal` 1080p and 60 fps (or 4K where granted), records what `getSettings()` grants and what the camera delivers, finds the frame, reads the header and compares every cell with the data the sender is known to send. For each pattern it reports the symbol error rate, the confusion matrix, the mutual information in bits per cell, an SNR in OKLab, clean, torn and blended frame counts, display frames per second, the cell size the camera resolved and a capacity estimate in KB/s. The slanted edge gives a line-spread deviation and an MTF50. Motion blur shows as a drop in classification confidence from frame to frame, so handheld and propped runs are compared with the same measure.
- **The report** is plain text on the page. The person copies it. Nothing is sent anywhere and nothing is stored.
- **Where it lives.** The page is `/dev-sandbox/optical-probe`, so it is not linked, robots.txt disallows it and the sitemap generator skips it. It does nothing unless the build sets `VITE_OPTICAL_MODEM=true`; otherwise it shows a one-line notice and loads none of the tool. The tool is a separate chunk (`ProbeApp`), outside the site-total bundle ceiling and never part of a first load. The analysis lives in `src/packages/optical-modem`, which also holds the channel simulator.
- **Photosensitivity.** Grid patterns change on every screen refresh, so the page carries the warning from #1148 and an always-visible Stop control, and Escape stops it. The flicker patterns are off until a checkbox turns them on, are never played when the device asks for reduced motion, and use two colour pairs that stay under the WCAG 2.3.1 general flash threshold (a relative luminance step under 0.1). High-frequency flicker still needs the review #1166 asks for before any shipped use.
- **Simulation.** The analysis is unit-tested on synthetic captures: perspective, lens blur, colour cross-talk, white balance, noise, a Bayer mosaic, JPEG, and a screen refresh in mid-readout. These tests prove the analysis, not any device. The benchmark ([OPTICAL_BENCHMARK](../OPTICAL_BENCHMARK.md)) shows what the simulator says; it is a model.

## Device results

Not measured yet. The probe has not been run on a phone. This table is filled in by a person with devices, and until it is, every geometry in the modem is provisional.

| Device         | Direction       | Held     | Granted capture | Cell size that reads (camera px) | Best constellation | Capacity (KB/s) | Recommended profile |
| -------------- | --------------- | -------- | --------------- | -------------------------------- | ------------------ | --------------- | ------------------- |
| Recent iPhone  | laptop to phone | propped  | not measured    | not measured                     | not measured       | not measured    | not measured        |
| Recent Android | laptop to phone | propped  | not measured    | not measured                     | not measured       | not measured    | not measured        |
| Older Android  | laptop to phone | propped  | not measured    | not measured                     | not measured       | not measured    | not measured        |
| Recent iPhone  | phone to phone  | handheld | not measured    | not measured                     | not measured       | not measured    | not measured        |
| Recent Android | phone to phone  | handheld | not measured    | not measured                     | not measured       | not measured    | not measured        |
| Older Android  | phone to phone  | handheld | not measured    | not measured                     | not measured       | not measured    | not measured        |

## Consequences

- The frame format and codec that these measurements tune are in [ADR 0028](0028-optical-modem-frame-format.md).
- The recommended constellation and cell size for each profile (P2 to P4) are set from this table, and the provisional geometries in the modem profile table are replaced then.
- The simulator already shows one thing worth checking on a device: in its model, colours placed for the largest OKLab gap beat the RGB cube corners on gap but not on symbol errors, because the model's cross-talk and white-balance drift act per RGB channel. A real camera decides which wins.
- The probe finds its fiducials with a luma threshold and needs cells of about 2.5 camera pixels or more. Below that it reports the frame as unreadable, which is itself a result: the cell is too small for this receiver.
