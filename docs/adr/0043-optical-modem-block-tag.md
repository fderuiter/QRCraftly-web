---
status: accepted
---

# Identity-Bound Tag on Every Optical Modem Block

## Context

The optical modem ([ADR 0028](0028-optical-modem-frame-format.md)) cuts each frame into Reed-Solomon blocks, and each decoded block is one droplet of the outer code. The decoder gave each block at most all its check bytes as erasures, then half, then none, and accepted the first attempt the code reported as a success. Nothing checked the result independently.

That is not safe. With as many erasures as check bytes, the code has no redundancy left and always finds a codeword, so when a block has at least as many unsure bytes as check bytes, the first attempt "succeeds" whatever the other bytes hold. Any block beyond the code's reach can also decode to the wrong codeword. A wrong block reaches the outer decoder and either stalls the transfer or, with an outer code that trusts its input, corrupts the file. The QR path already has a CRC-32C on every frame; the modem had none. The simulation benchmark counted only correct blocks, so these wrong accepts never showed (#1240).

The modem is behind the `VITE_OPTICAL_MODEM` build flag and has never shipped, so no user was affected. This had to be fixed before any rollout.

## Decision

- **Every block carries a 4-byte tag** after its data and before its check bytes, inside the Reed-Solomon codeword. A block is `packetBytes` data bytes, the tag, then `parity` check bytes, at most 255 bytes in all. `packetBytes` is still the droplet size the outer code sees, so the outer pipeline and the ladder's droplet size are unchanged.
- **The tag is bound to the block's identity.** It is CRC-32 (IEEE, the checksum in `crates/core`) over the session id, the frame sequence and the block's index in the frame, each as a big-endian 32-bit number, followed by the data. The outer code names a droplet by `seq * blocks + index` (or by the frame's first droplet in the ladder), so a block whose header was misread, or a good block replayed under another session, frame or index, is refused even when it is a valid codeword.
- **The decoder checks the tag after Reed-Solomon and before the block leaves the module.** A repair whose tag does not match is not accepted: the decoder goes on to the next, smaller set of erasures, and drops the block if none gives a matching tag. A block with no matching tag never reaches the outer code.
- **Refusals are counted.** The decoder reports, per frame, how many blocks had a first repair that the code accepted but the tag refused, which is the number the old decoder would have passed on wrong. `pnpm run bench:optical` and `pnpm run bench:optical-ladder` print it next to a count of wrong accepts (blocks returned as repaired whose bytes differ from those sent), which must be zero.
- **The format version stays 1.** ADR 0028 makes a change of inner code a new version so that receivers in the field keep working. There are none: the modem's data frames have never left the build flag, and the probe frames, which the probe page draws, did not change. A receiver built before this change cannot read the new blocks, and it never shipped. Keeping the version also keeps the probe frames, and the frozen probe results of the module's differential test, unchanged.

## Consequences

- A wrong block passes only if the code lands on a wrong codeword whose 32-bit tag also matches, about one chance in four billion per wrong repair.
- Each block carries 4 more bytes. Profiles 2 and 3 still fit the same number of blocks in a frame (480 and 1248 data bytes); profile 4 fits 35 blocks instead of 36, so a frame carries 2800 data bytes instead of 2880 (84 instead of 86 KB/s at 30 fps in the simulator).
- In the simulator, the tag refuses wrong repairs where the old decoder would have passed them, mostly at cell sizes too small for the profile and in the one-way ladder, where frames of a profile too dense for the receiver keep arriving ([OPTICAL_BENCHMARK](../OPTICAL_BENCHMARK.md), [OPTICAL_LADDER_BENCHMARK](../OPTICAL_LADDER_BENCHMARK.md)). Wrong accepts are zero in both.
- CRC-32 is an error check, not a message authentication code: it does not stop a sender who means to forge blocks. Protection against a deliberate forger is a job for authenticated encryption, not for this tag.
