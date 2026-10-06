# File transfer device checklist

The [transfer benchmark](TRANSFER_BENCHMARK.md) runs in Node. It can prove the codec and estimate the optical channel, but it has no real screen, lens or shutter. This checklist is what to measure on phones before a Prism or Optical feature leaves its feature flag. Record results in the table at the end and attach photos of the setup to the pull request.

## Setup

1. Send from a laptop or phone screen at full brightness, in a normal room, with the browser zoom at 100%.
2. Receive on a phone held about 30 cm away, in portrait, using the rear camera.
3. Use one file of each size: 12 KB, 256 KB, 2 MB. Use a file whose bytes are random, so compression cannot help.
4. Repeat each run three times and keep the median.

## What to measure

| Measure                     | How                                                                             |
| --------------------------- | ------------------------------------------------------------------------------- |
| Time to complete            | From the first frame shown to "Transfer Complete", with a stopwatch.            |
| Effective KB/s              | File size divided by the time to complete.                                      |
| Frames shown per second     | The sender's frame counter.                                                     |
| Frames the receiver decoded | The receiver's frame counter.                                                   |
| Joining mid-stream          | Start the receiver 10 seconds after the sender. It must still finish.           |
| Interruption                | Cover the camera for 3 seconds, then uncover it. It must continue, not restart. |
| Heat and battery            | Receiver battery use and whether it throttles after 2 minutes of scanning.      |

## Conditions

Run each of these at least once with the 256 KB file:

- Screen at 50% brightness.
- A phone tilted about 20 degrees.
- A sender at 60 Hz and, if one is available, at 120 Hz.
- A receiver camera at 30 fps and at 60 fps, where the phone offers both.
- Glare from a window on the sender's screen.

## Multi-code frames (#1142)

The bench simulates the display and the camera, so these need a phone before the feature leaves its flag. Turn on "Several codes per frame (preview)" under Advanced on the sender and "Read several codes per frame (preview)" on the receiver; the receiver then shows the size and frame rate the camera granted.

- Goodput of 2x2 v25 (1080p sender) and 1 x v40 against the bench's rates, with the receiver camera at 30 fps and at 60 fps.
- Whether the real camera resolves a 4 px module at the distance people hold it, and how many modules of drift per frame the 3-module crop margin survives with a hand-held phone.
- How often tracking is lost (full searches per minute) in a normal hold.
- Real decodes per second with the pool the receiver picks, and whether the preview and the sender page keep their frame rate.
- Torn frames: record the share of tiles that decode on a 60 Hz and a 120 Hz sender, staggered and not.
- The refresh rate the sender measures, against the display's real rate (power saving can change it mid-transfer).
- Beacons (#1143): move the receiver back until the tiles stop reading. Confirm the receiver says it reads the robust layer only and the transfer still finishes, and that it suggests a lower speed when nothing reads for five seconds. Record how far back the beacons still read at each density.

## Webcam back channel (#1146)

The simulation (`docs/FEEDBACK_BENCHMARK.md`) fixes how a receiver's reads are modelled and gives the back channel a delay and a loss rate. None of that was measured. Turn on both multi-code switches, "Let the receiver steer (preview)" on the sender and "Help the sender pick its speed (preview)" on each receiver. Before the feature leaves its flag, on a laptop sender and at least two receiver phones:

- Whether the sender's webcam reads the receiver's small corner code at all: distance, angle, glare from the sender's own screen, and the screen brightness of the phone. Record the share of feedback codes read and the delay from the receiver's screen to a decoded report. The simulation assumes 4 refreshes a second, 150 ms and 20% missed.
- The time from the receiver's "done" to the sender stopping, over at least 10 runs per phone. The target is 1 s at the worst case; the simulation's default channel gave 150 to 400 ms, and it went past 1 s in some runs when a report took 800 ms to decode, when four in five codes were missed, or when the receiver refreshed its code once a second.
- Whether the receiver's real "frame success rate" and "densest layer" match what the sender needs: how the receiver counts frames it did not see, and how long its reading window should be (the simulation uses 1 s).
- Whether the controller settles on the profile a person would pick by hand, and how often it probes a profile the phone cannot read (the simulation's probe costs about 6 percent of the goodput of a middle receiver).
- The camera permission prompt: it must appear only after "Let the receiver steer" is turned on. Check denial, dismissing the prompt, no camera, and unplugging an external webcam mid-transfer, and that each falls back to the one-way stream with the chosen profile.
- That the sender page keeps its frame rate while the webcam decodes feedback, and that the webcam light goes off when the person turns the option off or the transfer ends.
- Two receivers at once: that the sender follows the weaker one and does not stop until both show "done".
- Mixed sessions: the three profiles share one symbol size in the simulation (350 bytes) so a switch keeps one session. The shipped table uses different sizes, so a device run must confirm the shared size does not cost goodput on Steady.

## Colour layer (#1147)

The bench simulates the screen and the camera, so none of the colour numbers has seen a phone. The Colour profile stays off, and out of every screen, until these pass:

- Goodput of Colour (Fast with three codes per tile) against monochrome Fast on the same pair of devices, 1080p sender at 30 fps and at 60 fps. The criterion is at least 200 KB/s on at least one recent iPhone and one recent Android, and at least 1.8 times monochrome. The bench's figure is a simulation and is not a prediction.
- The real cross-talk matrix: log the fitted matrix and the patch residual (`CrossTalkModel.matrix`, `residual`) on each phone and each sender screen (an OLED, an LCD, a laptop panel). Check that `fitCrossTalk` accepts the patch at normal brightness and note the screens where it rejects it.
- Auto white balance and auto exposure: do they move during a transfer, how often does a new beacon patch refit (`driftRefits`) and how often does the quiet-zone white rescale the model (`rescales`)? Does the camera's exposure lock help or hurt?
- Gamma and clipping: the model is linear in the coded values. Record whether a white that clips in one channel breaks the fit.
- Decodes per second: Colour needs three decodes per tile, so 360 per second at 30 fps and 720 at 60 fps for a 2x2 layout. Record what the phone sustains, whether the preview keeps its rate, heat after two minutes, and what tier the receiver reports.
- Real compression: record whether the camera pipeline compresses (JPEG or video) and how it treats a colour channel at 4 px modules.
- Fallback: with the receiver far enough away that colour does not read, confirm the transfer finishes from the beacons and the receiver shows the "only the black and white codes are getting through" message.

## Outer code (#1176, #1141)

The new outer code ([ADR 0037](./adr/0037-prism-outer-code-lt-over-ldpc-precode.md)) decodes by Gaussian elimination as symbols arrive. On a shared x86-64 machine, in WebAssembly under Node, a full 8192-symbol block (512 KB at 64-byte symbols) is about 1.1 s of work in total, with about 80 ms left after the last symbol. Turn on "New transfer format (preview)" under Advanced on the sender ([ADR 0038](./adr/0038-prism-manifest-v2-outer-code-opt-in.md)) and record on a mid-range Android, with a file of about 4 MB at the balanced density (four blocks):

- The reassembly worker's total time for one 8192-symbol block, and the time from the last frame to "Transfer Complete".
- Whether the camera preview keeps its frame rate while blocks decode.

## Tiers

| Tier | Target                    |
| ---- | ------------------------- |
| 1    | 50 to 150 KB/s            |
| 2    | 200 to 500 KB/s           |
| 3    | 1 MB/s or more (moonshot) |

A feature stays behind its flag until the median run reaches the tier it claims, on at least two different phones.

## Results

| Date     | Sender | Receiver phone | File | Profile | KB/s | Notes |
| -------- | ------ | -------------- | ---- | ------- | ---- | ----- |
| none yet |        |                |      |         |      |       |
