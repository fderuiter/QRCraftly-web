---
status: proposed
---

# Webcam Back Channel: Feedback Frame, Speed Controller and Opt-In

## Context

A one-way stream cannot learn how well the receiver is doing. It never speeds up for a good camera, never slows down for a struggling one, and keeps playing after the file has arrived. Issue #1146 adds an optional back channel: the receiver shows a small code, the sender's webcam reads it. [ADR 0024](0024-prism-frame-format.md) reserved frame type 2 for it. This decision fixes the frame, the controller and the opt-in. The code is in `src/packages/optical-transfer` and nothing in the app imports it yet. The figures are from a simulation ([FEEDBACK_BENCHMARK](../FEEDBACK_BENCHMARK.md)), not a device.

## Decision

**Feedback frame.** Type 2 of the Prism frame, with the usual header and CRC-32C and a 9-byte payload: a 4-byte random receiver nonce, the fraction decoded (16 bits), the frame success rate (8 bits), the densest layer read (none, Steady, Balanced or Fast) and a done flag. It is 25 bytes, 38 Base45 characters, small enough for a corner of the screen. A receiver ignores it: `PrismReceiver` never ingests it as data. `looksLikePrismFrame` is still true for it, so a camera filter keeps it and `decodeFrame` tells the types apart. A type 2 frame with any other payload is rejected as malformed.

**Controller.** AIMD over the three profiles, following the weakest receiver that has not finished. A receiver that reads a lower layer than the one sent drops the sender to that layer at once (one rung when it reads no dense layer at all), and one that reads under half its frames costs one rung. Speed is added one rung at a time, only after every receiver read the current layer well for 2 s, and each back-off doubles that wait up to 16 s. After any change the controller sets reports aside for 1.5 s, because they still describe the old speed. The sender stops when every receiver in sight reports done; done is never undone by a late report. The starting profile is Balanced.

**One symbol size on the ladder.** The shipped profiles use different fountain symbol sizes, which gives each its own session ID: a receiver would start over at every switch. A steered sender must use one size on all three rungs (`switchableProfile`, 350 bytes). This is a precondition of steering. Whether 350 bytes costs goodput on Steady is open (device checklist).

**Receivers are nonces.** The sender tells receivers apart by the random nonce and keeps nothing else. The table is in memory, holds at most 16 receivers (the one heard from longest ago is evicted), and an entry expires after 5 s of silence. Nothing is stored or sent. The nonce is made per receive and never reused.

**Opt-in.** The state machine (`createFeedbackLink`) is off until the caller calls `enable()`, which is the only call that asks for the camera, through an injected function. Denial, no camera, an error or a camera that goes away leave the sender on the normal one-way stream with the profile the person chose and no auto-stop. The package never calls `getUserMedia`; the app's camera and UI are separate work.

## Consequences

- Proven in the simulation: with real frames, receivers and feedback codes and a modelled read chance, the sender settles on the best profile a receiver reads and the transfer completes. With the default back channel (4 codes a second, 150 ms to decode, 1 in 5 missed) it stopped within 1 s of done in every run; the worst was 1000 ms with two receivers.
- The cost of steering is the climb and the probes: a strong receiver finished in 7.1 s against 5.3 s for a sender that knew to use Fast, and a middle receiver paid about 6 percent for probing Fast. A sender that guesses too fast for a weak receiver is far worse, and a fixed profile never stops.
- Not proven: a webcam reading a phone's corner code, the delay and loss of that read, how a receiver measures its frame success rate, and the phone's reading window. The simulation assumes them. They are in the device checklist, and the feature stays off until that run.
- The back channel carries no file data and no identifiers. A feedback code tells anyone who can see the receiver's screen how far along the transfer is, which the screen already shows.
