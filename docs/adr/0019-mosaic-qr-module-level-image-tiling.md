---
status: accepted
---

# Mosaic QR: Module-Level Image Tiling

## Context

People want QR codes that carry a picture: a logo, a product shot or a pattern spread across the whole code rather than a small badge in the centre. Other generators call this "art", "halftone" or "mosaic" QR. There are three families of technique:

1. **Background image with transparent modules.** The image sits behind the code and modules are drawn over it. Contrast collapses wherever the image is mid-grey, so scans fail unpredictably.
2. **Data-driven module choice** (for example Russ Cox's QArt codes). The encoder picks padding bits and mask patterns so the modules themselves trace a picture. It only works for short, specific payloads and needs a custom encoder.
3. **Module-level recolouring** (halftone QR, Chu et al., SIGGRAPH Asia 2013, and the "colour mosaic" approach most web tools use). The standard matrix is kept bit for bit. Each module is repainted with the colour of the image beneath it, pushed just far enough towards its dark or light value to be read. Scanners sample the centre of each module after thresholding, so a module only has to be clearly dark or light near its centre.

QRCraftly already renders every style through `drawQRInternal` in the `qr-matrix` package, so canvas preview, templates, the virtual render used by the Scannability Worker, PNG export and SVG export (via `SvgContext`) all share one code path.

## Decision

Mosaic QR is a style option (not a separate page) implemented with technique 3 inside the `qr-matrix` package, behind a new `mosaic.ts` entry point.

### Engine (`src/packages/qr-matrix/lib/mosaic.ts`)

- **No flipped modules.** The QR matrix from the encoder is used unchanged. Every module keeps its polarity, so error correction is not spent on the picture; it stays available for a centre logo and for print or camera damage. Uploading a mosaic sets error correction to H by default.
- **Sampling.** The image is centre-cropped to a square ("cover" fit), composited over white, and area-averaged into one cell per module (`tiles`) or 3x3 sub-cells per module (`halftone`).
- **Luminance clamping.** Colours are adjusted in linear light so hue is kept: dark modules are scaled down until their WCAG relative luminance is at most `darkMax`; light modules are mixed towards white until it is at least `lightMin`. In `halftone` mode only the centre sub-cell (the **Mosaic Core**) gets the strict limits; the eight outer sub-cells get looser ones and carry the image detail.
- **Contrast setting.** One 0..1 value maps to the limits. At 0 the core contrast ratio is about 5:1; at 1 about 13:1. The default is 0.5. The linear-light helpers live in `src/utils/colorUtils.ts` (`srgbToLinear`, `linearToSrgb`, `getLuminanceFromLinearRgb`).
- **Function patterns.** Finder patterns with separators and format information, timing patterns, alignment patterns and version information are always drawn as whole tiles at the strict limits, and the styled eye renderer is skipped while a mosaic is active.
- **Quiet zone.** The existing four-module quiet zone is kept and filled with the background colour.
- **Output size.** Colours are quantised to steps of 8 per channel and same-colour horizontal runs are merged, then every colour is filled as one path. This keeps canvas draw calls and SVG element counts down.

### Image handling (`src/packages/qr-matrix/lib/mosaicSource.ts`)

- The upload goes through the existing `useImageUpload` validation and resizing and becomes a `data:` URL in `QRConfig.mosaicImageUrl`, like the logo.
- `loadMosaicSource` decodes it once on the main thread at no more than 512 px on the longest side and keeps up to four decoded images in memory. Nothing is persisted and nothing leaves the device.
- `drawQRInternal` stays synchronous: it reads the decoded pixels with `getMosaicSource`. `QRCanvas` repaints when decoding finishes and `generateQRSvg` awaits decoding before it renders.

### Verification

- The Scannability Worker already decodes the virtual render, and PNG, clipboard and share exports already run `validateScannability` on the canvas, so mosaic codes get the same decode check as every other style.
- The engine exposes `rasterizeMosaic`, a canvas-free RGBA rasteriser. Tests decode its output with jsQR for several payloads, error-correction levels, images (gradient, noise, black, white, checkerboard, stripes) and both modes, with and without blur.

  > **Amendment (#1178):** the tests now decode with QRCraftly's own decoder (`src/packages/qr-decode`, [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md)), which replaced jsQR everywhere.

## Rationale

- Recolouring keeps any payload and any content type working, where data-driven art only works for short payloads.
- Keeping every module's polarity makes scannability predictable and leaves the whole error-correction budget intact.
- Living inside `qr-matrix` and `drawQRInternal` means templates, borders, logos and every export format work with no extra code, and there is no new package seam or dependency cycle.

## Consequences

- A mosaic replaces the module pattern and eye styles while it is active; colours for modules come from the image.
- Halftone SVG exports are larger than plain ones (up to one path per distinct quantised colour).
- Very low contrast settings on busy images can still fail under blur; the scan badge and the export pre-flight check report this, and raising the contrast or switching to `tiles` fixes it.
