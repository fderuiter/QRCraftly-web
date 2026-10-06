---
status: accepted
---

# Print Simulation in Module Units

## Context

The Scannability Health check reads the preview twice: once as it is (the screen scan) and once after an optical print simulation. Only a pass on both earns "Scans reliably" ([ADR 0009](./0009-user-facing-scannability-status-vocabulary.md)).

The old simulation box-blurred the whole canvas with a radius of 5% of its width. That is 3 to 11 modules of blur depending on the code's version, so no code ever passed (0 of 270 plain codes, #1248) and every design read "Scans, but fragile". Three other things hid the problem:

- The blur skipped itself in automated browsers (`navigator.webdriver`), so no unit or E2E test ever ran it.
- The noise came from `Math.random()`, so the verdict could change between two identical checks.
- Large modules, blurred softly, defeat the decoder's 8-pixel block binarizer whatever the design.

## Decision

- **Module units.** `simulatePrint` (`src/packages/scannability/lib/opticalSimulation.ts`) takes the code where the screen scan found it (corners and version) and resamples it, with a 4-module quiet zone, to 6 pixels a module, about what a phone camera sees at scanning distance. The preview's size, its pixel ratio and the code's version no longer change the result.
- **Paper, ink, lens, sensor.**
  - Transparent pixels show the paper.
  - Grey levels are squeezed between paper (235) and ink (25).
  - A Gaussian blur of 0.3 modules, three box passes, stands in for ink spread and a slightly soft camera.
  - Sensor noise of 10 levels comes from a fixed seed.
- **Camera-style read.** The simulated print is read as the scanner's camera fallback reads (both polarities, a whole-frame threshold and a half-size retry), and it must give the same text as the screen scan.
- **Always on.** The simulation is deterministic, so automated browsers run it too. The `isTest` flag is gone from the check, the worker contract and their callers.
- **Calibration.** A test corpus pins the numbers (`src/packages/scannability/tests/printSimulation.test.ts`):
  - Plain codes from version 1 to 25 at every error correction level must pass.
  - Designs whose modules shrink to tiny dots must fail.

## Consequences

- A plain or lightly styled code reads "Scans reliably" again. "Scans, but fragile" now means the design loses modules when printed, which a phone would also struggle with.
- The check costs about 15 ms for a small code and about 170 ms for a version 33 code on a 1200-pixel canvas, in the worker. The old full-canvas blur cost more.
- Changing a constant in the simulation means re-running the calibration corpus. A real phone scan of a print is still the final word.
