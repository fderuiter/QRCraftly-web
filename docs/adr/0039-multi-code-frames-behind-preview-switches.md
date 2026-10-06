---
status: accepted
---

# Multi-Code Frames Behind Preview Switches

## Context

Issue #1142 asks the sender to show several large codes per frame, timed to the display, and the receiver to read all of them from each camera frame. #1170 built the parts: layouts, staggered refresh, vsync pacing, tile tracking and a decoder pool. The bench reached 134.8 KB/s for 2x2 v25 at 1080p and 30 fps against 78.9 KB/s for one v40 code, but it simulates the display and the camera. No phone has run it, and every merge to `main` ships to qrcraftly.com.

The receiver's scanner reads one code per camera frame, and the scanner page depends on that behaviour.

## Decision

- **Two switches, both off.** "Several codes per frame (preview)" under Advanced on the sender, and "Read several codes per frame (preview)" on the receiver. Without them nothing changes on either page.
- **Sender.** The layout comes from the square the transfer canvas can fill: its container's width, up to 85% of the window height. A screen too small for 3 CSS px modules keeps one code per frame and the page says so. Frames are sized for the tile's QR version at ECC L, and the slice worker encodes every frame at that version. The pacer measures the display from `requestAnimationFrame` timestamps and holds each frame for whole refreshes (`holdForTargetFps` with the page's frames per second). With a hold of 2 or more the two diagonal groups of tiles change on alternate refreshes.
- **Receiver.** The camera session runs the multi-code reader in place of the scanner's own loop, and asks for 60 frames a second as an ideal at full HD, never exact. The reader takes frames from `requestVideoFrameCallback` where the browser has it, else `requestAnimationFrame`. It sends each frame to a pool of 2 to 4 workers (`decoderPoolSize`) and skips a camera frame when every worker is busy. A full search reads up to 8 codes; once the codes match a layout, the next frames read each tile from its last corners with the Rust fast path (`readTracked`) until tracking is lost. A worker reads a whole frame, so the pool runs frames, not crops, in parallel. Data frames are deduplicated by session and symbol IDs before they reach the reassembly worker.
- **No speed in the UI.** The receiver shows the size and frame rate the camera granted, not a speed. Speeds wait for the phone run (#1173).

## Consequences

- The scanner page keeps its one-code loop: the camera session takes a caller's loop only when one is given.
- A sender and receiver that do not both turn the switch on still work: the receiver's usual loop reads the tiles one at a time, and the multi-code reader reads a single-code stream by searching every frame.
- The switches go away, and the defaults change, once the phone checks in [the device checklist](../TRANSFER_DEVICE_CHECKLIST.md) pass.
