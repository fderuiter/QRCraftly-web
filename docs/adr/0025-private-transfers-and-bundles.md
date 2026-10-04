---
status: accepted
---

# Private Transfers and Multi-File Bundles

## Context

[ADR 0024](./0024-prism-frame-format.md) reserved the encryption and layout fields of the Prism manifest. Optical transfer is a broadcast: anyone who can see the sender's screen can read the frames. People asked to send several files at once and to keep the content from a camera that is not meant to receive it (#1144, #1145).

## Decision

**Private transfers.** The sender makes a random 96-bit secret and shows it as 8 words from a 4096-word list (12 bits a word), or as a key QR (`QRKEY:WORD-WORD-…`). The two screens never carry the key in a Prism frame. HKDF-SHA-256 derives an AES-256-GCM key and an HMAC key from it and from the manifest salt. Each fountain block is sealed with AES-GCM using the block number as the nonce. The session ID is the first 6 bytes of HMAC-SHA-256 over the manifest, so only a holder of the key can tie frames to a manifest. A receiver with a key entered accepts only private transfers. Both screens show a 4-word fingerprint of the session so people can check they see the same stream. A stream the receiver was not expecting is offered to the user and never switched to silently.

The key is 96 bits rather than 128. It is typed or read by a person, it protects a short-lived broadcast, and every guess needs a full decode attempt. The 8-word code was kept short enough to read out loud.

**Bundles.** Several files, or a folder, are packed into one message and sent as one stream. The file index (path, size, type, SHA-256) lives inside the message rather than in the manifest, because a QR code cannot hold up to 1000 entries. The manifest carries only the layout, the unpacked length, the unpacked SHA-256 and the entry count. `sanitizeRelativePath` rewrites hostile paths (traversal, absolute, reserved device names, control characters). Each file is checked against its SHA-256, and one bad file fails the whole bundle.

## Consequences

- Private mode protects against a camera that sees the screen but does not have the key. It does not protect against someone who also learns the key, and it does not hide that a transfer is happening or its approximate size.
- The manifest has 12 positional fields; older receivers ignore the stream with a version message.
- The word list is part of the format. Changing it needs a new format version.
