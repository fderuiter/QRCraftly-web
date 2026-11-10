# `core` (`@/packages/core`)

The shared bottom layer of the packages ([ADR 0052](../../../docs/adr/0052-shared-core-package.md)).

## Contract

- **Shared by two or more packages.** Code that only one package uses lives in that package, and app-only code stays in `src/types.ts`, `src/constants.ts` or `src/utils/`.
- **A leaf.** `core` imports nothing else in `src`: no other package and no app code. The `core-is-a-leaf` boundary rule enforces this.
- **One entry point per concern, no barrel.** Import the entry you need directly. There is no `index.ts`.

## Entry points

- `checksum`: `crc32`, `crc32c` and `crc32Hex`, for the ZIP writer and the optical transfer codecs.
- `config`: `DEFAULT_CONFIG`, the generator's starting settings.
- `ecc`: `EccLevel` and `ECC_LEVELS`.
- `encoding`: byte, hex and SHA-256 helpers.
- `files`: file-name cleaning, invisible-character checks and received-file analysis.
- `security`: dangerous-URL, text and SVG sanitising checks, the image upload limits, and the Trusted Types policy (`sameOriginWorker`, `trustedScriptUrl`, `parseInertMarkup`).
- `site`: the configured public domain (`getPublicDomain`).
- `types`: the shared QR types: `QRConfig`, `QRType`, `QRStyle` and the frame, border, mosaic, gradient and Wi-Fi types `QRConfig` uses. Payload data types (`EmailData`, `VCardData` and so on) and brand templates stay in `src/types.ts`.
- `url`: URL normalisation.
- `zip`: `createZip`, a minimal ZIP writer (stored entries, CRC-32, UTF-8 names) for Bulk CSV, wallet passes and received bundles.

More entry points arrive with the slices that move code here (#1524-#1529).
