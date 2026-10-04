---
status: proposed
supersedes_in_part: 0021
---

# Multi-Rate Stream and Steady, Balanced and Fast Profiles

## Context

[ADR 0021](./0021-transfer-density-profiles-and-stream-scanning.md) gave the sender three densities, each a QR version bound and an error correction level, for one small code per frame. [ADR 0024](./0024-prism-frame-format.md) and the multi-code layouts of #1142 changed what a frame can hold: several large codes at once, all at error correction L, with the fountain code absorbing the loss. The sender still has to guess what the receiver's camera can read. Guess too dense and the transfer stalls with no hint why; guess too sparse and a good camera sits idle.

## Decision

**Beacons.** The sender interleaves dense frames (the tiles of a layout) with a beacon: one larger code shown at full size that carries the manifest and a few symbols. Dense tiles and beacons come from the same fountain code with the same symbol size and the same session ID, so every frame feeds the same decoder. A strong camera reads everything. A weak or distant one still finishes from the beacons alone, because a beacon's modules are larger on screen. The beacon stream sends the manifest every 4th beacon, since a receiver cannot use a symbol before it has the manifest.

A receiver tells a beacon from a dense tile by its size: the beacon's QR version is always larger than a tile's, so its text is longer than a tile can hold.

**Profiles.** `MULTI_RATE_PROFILES` in `lib/multicode/multirate.ts` replaces the density table of ADR 0021 for transfers that use multi-code frames:

| Profile            | Dense layer      | Target fps  | Beacon     | Aims at                           |
| ------------------ | ---------------- | ----------- | ---------- | --------------------------------- |
| Steady             | 1 × v30, ECC L   | 15          | every 4th  | 15 to 30 KB/s, weak cameras       |
| Balanced (default) | 2×2 × v20, ECC L | 30          | every 8th  | 50 to 150 KB/s                    |
| Fast               | 2×2 × v25, ECC L | 60 (hold 1) | every 12th | 150 to 300 KB/s on 60 fps cameras |

Steady uses one v30 code at ECC L because the layout table has no v25 at ECC M; a device run decides whether that should change. The tiers are targets, not measurements. The old three densities stay for senders whose screen is too small for any layout.

**Receiver hint.** The receiver reports which layer it reads. When it reads beacons and no dense tiles it says "Reading the robust layer only. Move closer or hold steady for full speed." After five seconds without progress it suggests a lower speed. The wording is fixed and tested (`layerHint`).

## Consequences

- Proven in the unit tests: a receiver fed only the beacons completes every transfer under all three profiles, and a mix of dense frames and beacons with a third of the frames lost completes too.
- Derived, not measured: the bench of #1142 reached 89.6 KB/s for 2×2 v20 at 720p and 30 fps and 272.7 KB/s for 2×2 v25 at 60 fps with a camera that captures 60 distinct frames a second. Beacons take one frame in 8 and 12, so the dense layer keeps 7/8 and 11/12 of those figures before the beacons' own symbols are counted. They are a ceiling for the code and decode chain, not a prediction for a phone.
- Not done and needed before this ADR is accepted: a real-device run of Balanced on a mid-range Android (`docs/TRANSFER_DEVICE_CHECKLIST.md`), the sender and receiver UI, and the speed estimate before sending. Nothing in the app calls the multi-rate sender yet; it is off unless a caller asks for it.
