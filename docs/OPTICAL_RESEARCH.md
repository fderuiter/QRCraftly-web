# Optical research notes: GPU decoding, the ladder and rolling-shutter modulation

Research notes for QRCraftly Optical (#1161), written for issue #1166 (temporal and rolling-shutter modulation), with the findings of #1164 and #1165 collected at the end. Read it as a record of what is known, what was reasoned and what nobody has measured. **No phone was used for any of this.** Every figure that comes from this repository is a simulator result, and a model of a camera is not a camera.

The architecture, protocol and validation plan these notes feed into are in [Optical Transfer design](optical-transfer/README.md).

## How to read the claims

- **Measured here**: produced by a command in this repository, on the channel simulator or in a headless browser. The command is named.
- **Reasoned**: arithmetic or logic from stated assumptions. The assumptions are listed and none was checked on a device.
- **Cited**: taken from a source in the list below. For each source the list says how much of it was actually read.
- **Not measured**: said so in those words. These are the open questions, and the answer to each of them needs a phone.

## Sources, and how far each was checked

- Izz, Li, Liu, Chen and Li, "Uber-in-Light: Unobtrusive Visible Light Communication Leveraging Complementary Color Channel", IEEE INFOCOM 2016. Read as a search summary only: it sends data as complementary intensity changes in the red, green and blue channels so that a viewer sees no change, and decodes it with a camera. The paper itself was not read, so no figure from it is used. Search listing: [IEEE Xplore](https://ieeexplore.ieee.org/document/7524513/).
- "DisCo: Display-Camera Communication Using Rolling Shutter Sensors", listed by title and venue only ([ResearchGate](https://www.researchgate.net/publication/305743979_DisCo_Display-Camera_Communication_Using_Rolling_Shutter_Sensors)). It is cited as evidence that display-to-camera communication that uses a rolling shutter has been built. Its results were not read.
- Rolling-shutter optical camera communication with LED transmitters, as search results list them: rates of a few kilobits per second to about 200 kbps over metres, and 450 bit/s at 400 m. These are LED transmitters read by a rolling-shutter camera, a different channel from a screen read by a phone, and are not used as a bound here. One example: [Optical Camera Communications for IoT, Rolling-Shutter Based MIMO Scheme](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7348962/). Only the search summary was read.
- The W3C [MediaStream Image Capture](https://www.w3.org/TR/image-capture/) specification defines the `exposureTime` and `exposureMode` constraints. That a browser implements them was **not** confirmed: MDN's compatibility tables could not be reached from the build sandbox, and a search returned only a 2018 remark that no browser supported `exposureTime` then. The claims in the issue that some Android Chrome devices expose it and iOS Safari does not are the issue author's, and are treated here as unverified.
- `requestAnimationFrame` is tied to the display refresh. This is stated in the issue and is general web knowledge; the specification page was not re-read for these notes.
- Cimbar's 106 KB/s at 15 fps on a 2017 phone and PixNet's 12 Mb/s with custom hardware are the issue's figures. They were not re-checked.

## Part 1. Rolling-shutter and temporal modulation (#1166)

### The idea

A phone camera reads its sensor row by row. If the screen changes while a frame is being read, the top and bottom of the picture show different screen states, and the boundary is a horizontal band. Time becomes a position in the image.

### What the browser can control

**Display timing (reasoned).** A page can change what the screen shows once per display refresh at most, because a drawing callback runs once per refresh: 60 Hz gives 16.7 ms, 120 Hz gives 8.3 ms. There is no way to time a change inside a refresh interval, and a missed frame cannot be told from a slow one without measuring it (the probe does count display frames). So the screen's states in time are a sequence of whole frames, never a continuous signal.

**Exposure control (not measured).** The specification has the constraints, and whether the phones that matter implement them is the open point above. Without a short exposure, a camera integrates several refreshes into each row and the band edges blur. A short exposure also darkens the picture, which the receiver has to make up with gain and noise. The probe records the granted settings; it does not set the exposure, so this is unmeasured on every device.

### How much a rolling shutter can add (reasoned)

Assume a row readout that takes about one camera frame interval, which is typical but unchecked (it is a property of each sensor), and the camera at 30 fps while the display runs at 60 or 120 Hz.

- One camera frame spans about 33 ms. At 60 Hz that is two display refreshes, so one captured frame can hold at most two screen states, joined at one boundary row. At 120 Hz it holds at most four, with three boundaries.
- A boundary row is a number of about 10 bits (over 1,080 rows), and it carries information only if the sender could place the change somewhere other than at the refresh, which it cannot: the change happens at the refresh, and its row in the image is set by when the refresh falls against the camera's readout, which the sender does not control and the receiver knows only by measuring.
- So the temporal channel is **the refreshes the camera happens to straddle**. The modem already draws a complete frame at every refresh. A camera that straddles two refreshes captures two modem frames, each cut at a boundary. That is not a new dimension on top of the grid. It is more grids per second, seen in two pieces.

The consequence is that a rolling shutter makes tearing, and tearing is already what the existing design treats as damage: the header is repeated in the top and bottom bands and read from each strip alone before both together ([ADR 0028](adr/0028-optical-modem-frame-format.md)), and blocks of a frame are interleaved so a lost stripe costs every block a few bytes. The probe counts clean, torn and blended frames ([ADR 0027](adr/0027-optical-channel-probe.md)), which is the measurement that says how often it happens.

### Combining with the grid (reasoned, not measured)

Three things would have to be true for a temporal profile to pay, and none has been shown:

- the exposure is short enough, on enough phones, to keep a sharp boundary (unmeasured, and absent on iOS if the issue is right);
- the receiver can decode both halves of a torn frame, which today's decoder does not do (it decodes one grid per frame and counts a torn frame as damage); and
- the gain is more than the extra display refreshes would give a plain grid at 60 Hz instead of 30.

A simpler way to use the refreshes already exists: show a new grid at every refresh and let the camera take what it takes, while the outer code absorbs the loss. That needs no exposure control and no knowledge of the boundary.

### Photosensitivity

Alternating at 60 or 120 Hz is far above the three-flashes-a-second limit of WCAG 2.3.1 unless the luminance step stays under the general flash threshold. The probe's flicker patterns use two colour pairs that stay under it and are off until the person turns them on ([ADR 0027](adr/0027-optical-channel-probe.md)). Any pattern that ships needs the specific review #1148 asks for, and a high-frequency pattern that is only readable with a large luminance step would not pass it.

### Recommendation, and what is missing

Provisional: **do not build a P5 profile.** The reasoning above says the rolling shutter turns refreshes into tears rather than into capacity, and the cheaper use of those refreshes needs nothing the browser may refuse.

It is not closed as "not planned" because the issue asks for device measurements and there are none. What would settle it:

1. Run the probe's flicker patterns at 60 and 120 Hz on at least one iPhone, one recent Android and one older Android, with `exposureTime` set where the browser allows it and left alone where it does not. Record the granted settings, the band count per camera frame and the clean, torn and blended frame counts.
2. Measure the row readout time from the slanted-edge pattern and the flicker patterns together.
3. Count how many torn frames the existing decoder could have used if it decoded both halves.

If torn frames are common (many per second) and both halves decode, a decoder that uses both is worth building, and it is an improvement to the grid modem, not a new profile.

## Part 2. What the GPU and ladder work found

Summarised from [ADR 0029](adr/0029-optical-gpu-decode-kernel.md) and [ADR 0030](adr/0030-optical-profile-ladder.md); see them for the commands and caveats.

- **Measured here.** A WebGL 2 port of the per-cell decode kernel is bit for bit equal to the reference kernel on software rendering (SwiftShader, headless Chromium 147): no mismatching value in 141,840 cells, the same repaired blocks in 18 simulated frames, and it works under the site's script policy. A deliberately wrong input is detected. The command is `pnpm run bench:optical-gpu`.
- **Measured here, and not a GPU.** On that software path a 512 x 270 grid at 1080p takes about 40 to 54 ms per frame and the reference kernel in Node about 56 to 60 ms, on a machine shared with other jobs. This says nothing about a phone's GPU.
- **Reasoned.** The language does not promise IEEE division or unfused arithmetic in a fragment shader, so equality has to be checked on each device. The receiver runs a self-test and stays on the CPU if it fails.
- **Measured in the simulator.** With the default interleave, receivers of three different quality all complete a 60 KB file, but a one-way ladder gives them 29 to 58% of what the best single profile would, and a feedback lock brings the data rate after lock to 92 to 94% of it. `pnpm run bench:optical-ladder`.
- **Not measured.** Any real GPU, 60 fps at 512 x 288 on any phone, the iPhone, long tasks on the main thread during a transfer, camera frames uploaded as video frames, the thresholds and weights of the ladder on a real camera, and everything in Part 1 that needs a phone.
- **Found on the way.** The ladder needs one droplet size across profiles (16 bytes with today's profiles) and the frame number as the index of the frame's first droplet, which amends the numbering in ADR 0028 for interleaved streams.

## Open questions in one list

1. Does the shader compile and match the reference on real phone GPUs (Mali, Adreno, Apple)? The self-test answers it per device.
2. Can a mid-range Android sustain 60 fps at 512 x 288 through the kernel, including upload and read-back?
3. Do `exposureTime` and `exposureMode` exist on the phones that matter?
4. How often are camera frames torn at 60 and 120 Hz, and could both halves be decoded?
5. Do the ladder's thresholds and interleave weights hold on a real camera, and how long does a feedback lock really take?
