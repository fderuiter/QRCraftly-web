---
status: accepted
supersedes_in_part: 0014, 0024
---

# Wallet-Compatible BC-UR Sending

## Context

[ADR 0014](./0014-rateless-fountain-codes-for-airgapped-optical-transfer.md) framed our droplets as `ur:bytes/` parts, but mixed them with our own Robust Soliton and Mulberry32 schedule, so BC-UR wallets and tools could not read them. [ADR 0024](./0024-prism-frame-format.md) moved our own transfers to Prism and kept a receive path for the old droplets for one release, which was v0.10.0. #1170 then added a real BCR-2024-001 codec, and the receiver reads wallets' animated QR codes with it. What was left of #1149 was sending in that format, and removing the old droplets.

## Decision

- **Sending.** The sender has a "Wallet-compatible (BC-UR)" switch under Advanced. With it on, the file goes out as a real BCR-2024-001 `ur:bytes` stream: the pure fragments first, then mixed parts for as long as the stream runs. The parts are made on the main thread by our own encoder (`lib/bcur`, loaded only in this mode) and drawn by the same frame renderer as a Prism stream, after the same scannability check on the first frame.
- **Frame size.** The density's QR version and error correction set the fragment length, so that the longest possible part fits that version in alphanumeric mode, and every frame is that version.
- **What it carries.** Only the file's bytes. BC-UR has no place for the name, type, compression, a second file or a key, so the mode sends one file at a time and is off for a private transfer. The other Advanced options do not apply to it.
- **Old droplets.** The receiver no longer reads the ADR 0014 droplets. Any `ur:` code goes to the BC-UR decoder only. The droplet string format, the old session header and the code that sized and opened it are removed; the LT code itself stays, because Prism uses it.
- **Checks.** Our encoder matches `@ngraveio/bc-ur` and the published BCR-2020-005 and BCR-2024-001 vectors, which are frozen as fixtures ([ADR 0040](./0040-in-house-first.md)). The sender's own stream is read back by our decoder in its tests.

## Consequences

- QRCraftly can send to hardware wallets and other BC-UR apps, and a QRCraftly receiver reads that stream too.
- A wallet-compatible stream carries fewer bytes per frame than Prism (Bytewords take four letters a byte), so it is slower. The page says so.
- A sender from before v0.10.0 can no longer send to a current receiver.
