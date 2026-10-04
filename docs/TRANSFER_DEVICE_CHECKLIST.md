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
