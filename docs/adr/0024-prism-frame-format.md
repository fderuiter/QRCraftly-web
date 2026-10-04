---
status: accepted
supersedes_in_part: 0014
---

# Prism Frame Format for Optical Transfer

## Context

[ADR 0014](./0014-rateless-fountain-codes-for-airgapped-optical-transfer.md) framed every fountain droplet as a BC-UR `ur:bytes/` part: CBOR, then Bytewords, then a CRC-32. That format is interoperable but costly. Bytewords turn each byte into four letters, and a QR code stores letters at about 5.5 bits each, so a droplet carried roughly 0.4 payload bytes per bit of QR capacity. The bundled session header was also not authenticated against anything the receiver could check before it allocated memory. The transfer abuse review (#1150) needed receive caps, a manifest the receiver can inspect first, and a way to tell a lying sender from an honest one.

## Decision

Optical transfer uses the Prism frame format.

- **Text:** Base45 ([RFC 9285](https://www.rfc-editor.org/rfc/rfc9285)), which QR codes store in alphanumeric mode at 5.5 bits per character. That is 2 characters for every 2 bytes of payload plus a third for the remainder, so each frame carries about 1.4 times the payload that `ur:bytes/` carried at the same density.
- **Frame:** a 16-byte overhead. Byte 0 is `0xA0 | version`, byte 1 is `type << 5 | flags`, then a 6-byte session ID, a 3-byte first symbol ID, a 1-byte symbol count, an optional block number when the multi-block flag is set, the payload, and a CRC-32C. Types are data (0), manifest (1) and feedback (2, the webcam back channel; see [ADR 0032](./0032-webcam-back-channel.md)).
- **Manifest:** a positional CBOR array carrying the file entries (name, size, type, SHA-256), the compression flag, the transfer length, the symbol size, the transfer CRC-32C, the salt and the encryption block. It is sent as frame 0 and again every 16th frame. The session ID is the first 6 bytes of the SHA-256 of the manifest bytes, so a manifest that does not match its session ID is ignored.
- **Code:** the same Luby Transform code with a robust soliton distribution. Symbol IDs are 24 bits and consecutive within a frame.
- **Receiver:** limits are enforced before any decoder or buffer is allocated. The receiver shows the manifest (name, type, size, fingerprint) before the file completes, verifies the SHA-256 and the size at the end, and bounds decompression by the manifest size. A stream that needs more than the large-block threshold of blocks must repeat 8 times before tables are built. It switches to another session only after 8 frames from a known candidate manifest. Frames that are encrypted or multi-block are ignored until the features that read them ship. A newer format version shows a one-time message.
- **Removed:** `ur:bytes/` sending, the `H|`/`F|` legacy carousel and stream lookahead. The receiver still reads `ur:bytes/` frames for one release and then drops that path.

The density profiles of [ADR 0021](./0021-transfer-density-profiles-and-stream-scanning.md) still choose the QR version and error correction level. Prism only changes what goes inside the QR code.

## Consequences

- More payload per frame, so fewer frames and a shorter transfer at every density. `pnpm run bench:transfer` reports the gain; see [the benchmark report](../TRANSFER_BENCHMARK.md).
- A sender and a receiver on different releases only interoperate through the one-release `ur:bytes/` receive path.
- Fields that later work needs (multi-block, encryption, feedback) are reserved in the format, so they do not need another version.
- BC-UR interoperability is no longer free. The receiver now reads real BC-UR multipart streams (BCR-2024-001) from wallets next to its own (#1149); sending in that format is still open.
