---
status: accepted
---

# Webcam Back Channel: Feedback Frame, Speed Controller and Opt-In

## Context

A one-way stream cannot learn how well the receiver is doing. It never speeds up for a good camera, never slows down for a struggling one, and keeps playing after the file has arrived. Issue #1146 adds an optional back channel: the receiver shows a small code, the sender's webcam reads it. [ADR 0024](0024-prism-frame-format.md) reserved frame type 2 for it. This decision fixes the frame, the controller and the opt-in. The code is in `src/packages/optical-transfer`, and the file-transfer pages use it behind two preview switches. The figures are from a simulation ([FEEDBACK_BENCHMARK](../FEEDBACK_BENCHMARK.md)), not a device.

## Decision

**Feedback frame.** Type 2 of the Prism frame, with the usual header and CRC-32C and a 9-byte payload: a 4-byte random receiver nonce, the fraction decoded (16 bits), the frame success rate (8 bits), the densest layer read (none, Steady, Balanced or Fast) and a done flag. It is 25 bytes, 38 Base45 characters, small enough for a corner of the screen. A receiver ignores it: `PrismReceiver` never ingests it as data. `looksLikePrismFrame` is still true for it, so a camera filter keeps it and `decodeFrame` tells the types apart. A type 2 frame with any other payload is rejected as malformed.

**Controller.** AIMD over the three profiles, following the weakest receiver that has not finished. A receiver that reads a lower layer than the one sent drops the sender to that layer at once (one rung when it reads no dense layer at all), and one that reads under half its frames costs one rung. Speed is added one rung at a time, only after every receiver read the current layer well for 2 s, and each back-off doubles that wait up to 16 s. After any change the controller sets reports aside for 1.5 s, because they still describe the old speed. The sender stops when every receiver in sight reports done; done is never undone by a late report. The starting profile is Balanced.

**One symbol size on the ladder.** The shipped profiles use different fountain symbol sizes, which gives each its own session ID: a receiver would start over at every switch. A steered sender must use one size on all three rungs (`switchableProfile`, 350 bytes). This is a precondition of steering. Whether 350 bytes costs goodput on Steady is open (device checklist).

**Receivers are nonces.** The sender tells receivers apart by the random nonce and keeps nothing else. The table is in memory, holds at most 16 receivers (the one heard from longest ago is evicted), and an entry expires after 5 s of silence. Nothing is stored or sent. The nonce is made per receive and never reused.

**Opt-in.** The state machine (`createFeedbackLink`) is off until the caller calls `enable()`, which is the only call that asks for the camera, through an injected function. Denial, no camera, an error or a camera that goes away leave the sender on the normal one-way stream with the profile the person chose and no auto-stop. The package never calls `getUserMedia`: the sender page passes `requestWebcam`, which opens the front camera.

**In the app.** Both switches are previews and need the multi-code switches of [ADR 0039](./0039-multi-code-frames-behind-preview-switches.md), since the ladder is the multi-rate profiles of [ADR 0031](./0031-multi-rate-stream-and-speed-profiles.md).

- _Sender._ "Let the receiver steer (preview)" under Advanced. The webcam is asked for when a transfer starts, not when the switch is turned on, and let go when it stops. The transfer starts on the profile of the chosen density at 350-byte symbols. The webcam's frames go to one decoder worker of the multi-code reader (`createTileReader`), and every feedback code it reads goes to the controller, which also runs every 100 ms. The page names the profile on screen and how many receivers steer it, and says why when it runs one way.
- _Switching._ The sender asks the slice worker for the profile's layout (`SWITCH`). The worker keeps the session and builds new streams of it (`PrismSession.restream`) that start past the symbols already shown (`startSymbol`), so a receiver keeps everything it has. Frames of the old layout still in flight are dropped, and the page shows the new layout from its first frame. A screen too small for a profile's layout stays where it is.
- _Receiver._ "Help the sender pick its speed (preview)". While it is on and a transfer is in view, the page shows the feedback code in a corner, repainted 4 times a second, with a new nonce per receive. The fraction decoded is the decoder's rank over K. The frame success rate is the mean over the last 30 camera frames of the share of the layout's tiles each read: a frame that read only a beacon counts 1 and one that read no transfer code counts 0 (`createFeedbackMeter`). The densest layer is the fastest profile any of those frames read a tile of, told by the tile's QR version. Done is set once the file is verified, and the code stays up until the person clears the receiver.

## Consequences

- Proven in the simulation: with real frames, receivers and feedback codes and a modelled read chance, the sender settles on the best profile a receiver reads and the transfer completes. With the default back channel (4 codes a second, 150 ms to decode, 1 in 5 missed) it stopped within 1 s of done in every run; the worst was 1000 ms with two receivers.
- The cost of steering is the climb and the probes: a strong receiver finished in 7.1 s against 5.3 s for a sender that knew to use Fast, and a middle receiver paid about 6 percent for probing Fast. A sender that guesses too fast for a weak receiver is far worse, and a fixed profile never stops.
- Not proven: a webcam reading a phone's corner code, the delay and loss of that read, whether the measure above is the right frame success rate, and the phone's reading window. The simulation assumes them. They are in the device checklist, and both switches stay previews until that run.
- The sender page loads the multi-code reader's decoder worker and the QR reading module only when steering starts.
- The back channel carries no file data and no identifiers. A feedback code tells anyone who can see the receiver's screen how far along the transfer is, which the screen already shows.
