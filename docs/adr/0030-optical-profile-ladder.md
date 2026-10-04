---
status: proposed
---

# Optical Profile Ladder and Link Display

## Context

A one-way optical link cannot ask the receiver which profile it reads best. Choosing for the worst camera wastes a good one, and choosing for the best strands a weak one. QRCraftly Optical (#1161) therefore sends several profiles in turn and lets every receiver use what it can lock. This decision (issue #1165) fixes the ladder, how the sender interleaves it, how a receiver decides what it has locked, how the sender can lock, and what the receiver shows. The code is in `src/packages/optical-modem` (`ladder.ts`) and `src/components/transfer/OpticalLinkDisplay.tsx`.

Everything below was run on the channel simulator only ([OPTICAL_LADDER_BENCHMARK](../OPTICAL_LADDER_BENCHMARK.md)). No phone was involved, and the interleave and lock thresholds are starting values to be replaced by device results ([ADR 0027](0027-optical-channel-probe.md)).

## Decision

### The ladder

| Profile | Content                              | In this repository                       |
| ------- | ------------------------------------ | ---------------------------------------- |
| P0      | Monochrome QR beacons, huge cells    | Prism Stage A; not drawn by this package |
| P1      | Dense monochrome multi-QR            | Prism Stage A; not drawn by this package |
| P2      | 4-colour modem grid, 104 x 58 cells  | `MODEM_PROFILES`                         |
| P3      | 8-colour modem grid, 120 x 67 cells  | `MODEM_PROFILES`                         |
| P4      | 16-colour modem grid, 160 x 90 cells | `MODEM_PROFILES`                         |
| P5      | Temporal modulation                  | Research only, not built (#1166)         |

P2 to P4 are the provisional geometries of [ADR 0028](0028-optical-modem-frame-format.md). The issue calls P4 "8-colour, densest"; the profile in the codec has 16 colours, and the ladder follows the codec.

### One-way interleave

The sender plays a fixed cycle (`ladderSchedule`). The default gives the dense profiles most of the airtime: of 12 frames, P4 has 5, P3 has 3, P2 has 2, and P0 and P1 one each. The cycle is a smooth weighted round-robin in integer arithmetic, so every engine produces the same one, equal profiles are spread out, and the beacon is always present so a receiver can join at any time. The weights are a guess made without a device. They are the main lever of the one-way link: more airtime for the dense profiles speeds strong receivers and starves weak ones.

### Droplets that every profile can carry

For the receiver to use whatever it locks, a frame of any profile has to carry droplets of the same outer code. Two changes from ADR 0028 follow.

- **One droplet size.** Profiles have 80 or 96 data bytes per block, so the droplet is 16 bytes, the largest size dividing both. A block carries 5 or 6 whole droplets. Droplets of 80 bytes would waste 16 of every 96 bytes of profile 3. Smaller droplets mean a larger `k` for the same file; the benchmark's 60 KB file is 3,750 droplets and decodes without trouble.
- **The frame number is the index of the frame's first droplet.** ADR 0028 numbers a block's droplet `seq * blocks + index`, which only works while every frame has the same number of blocks. With several profiles it does not. The header's 32-bit `seq` field now holds the running droplet index at the start of the frame, and block `b`, droplet `j` of the frame is `seq + b * perBlock + j`. The field is already unique per frame (it seeds the whitening), nothing in the header changes, and no version change is needed. This amends the numbering rule of ADR 0028 for interleaved streams.

### What the receiver locks

`LinkTracker` keeps the last three seconds of camera frames. A profile counts as **locked** when at least three of its frames were read in the window and, on average, at least half of their blocks repaired. The locked profile is the densest such profile. The data rate is the data bytes of repaired blocks over the window, before the outer code's overhead. The camera rate is the frames per second the receiver actually sees. All thresholds are heuristics set on the simulator.

QR frames are read by the QR receiver, not by this tracker. A receiver that reads only QR has no modem lock, and the display says "No lock yet" and why the modem is off (the fallback messages of [ADR 0029](0029-optical-gpu-decode-kernel.md)). Feeding P0 and P1 reads into the same tracker is not done here.

### Locking the sender

- **With the back channel (#1146).** The receiver's feedback carries one small integer, its locked profile. The sender calls `lockedSchedule(profile)`, which sends that profile on 15 frames of 16 and a beacon on the sixteenth, so a second receiver can still join. Prism's frame format already reserves a feedback frame type ([ADR 0024](0024-prism-frame-format.md)). **No change to `optical-transfer` was needed** and none was made. Building the feedback frame is #1146's work, and it only has to carry the profile number.
- **Without it.** The receiver shows "Locked P3" in large type, and the person at the sender taps "Lock to P3", which calls the same function. That button is not built: the sender's controls belong to the transfer pages, not to the experimental modem.

### Link display and names

`OpticalLinkDisplay` shows the lock level, the line "Optical link: 8-colour · 120×67 · 30 Hz · 37 KB/s" (colours, grid, camera frames per second, data rate; the issue's example shows the 512 x 288 grid of its capacity table, and the line shows the profile's own grid) and what would raise it. It uses the shared `Badge`, semantic colour tokens and a card layout, and a `role="status"` region for speech.

- The visible text follows every update; the caller updates about once a second.
- The spoken announcement is separate: a change of lock is read at once, a change of advice at most every five seconds, and the data rate is never read. A test checks this and checks that the display has the one live region.
- The advice has five codes: find the screen, raise the brightness, move closer, hold steady (or prop the phone), and nothing to add. They come from the failures and block shares in the window. They are heuristics: from a decode result, "the cells are too small" and "the hand is shaking" look alike, so the rule is that damage on some frames and not others reads as shake and steady damage as small cells. Nobody has checked this against a device.
- Names. The QR speeds stay Steady, Balanced and Fast (#1062). The modem rungs are "4-colour (experimental)" for P2 and "Max (experimental)" for P3 and P4, until real-device numbers are in. The codec's own profile names (Steady, Fast, Rapid) are internal and not shown.
- Where it is shown. The component is used by the probe page (`/dev-sandbox/optical-probe`, behind `VITE_OPTICAL_MODEM`, in the page's lazy chunk) in a replay on simulated captures, labelled as a simulation. There is no modem receiver page yet.

## Results (simulator)

Three simulated receivers differ in channel and in how many camera pixels span the frame, so each one reads up to a different rung (a table in the benchmark). A 60 KB file, 30 camera frames per second, QR rungs not simulated (their airtime, 17% of the cycle, is lost to these modem-only receivers):

- **Every capped receiver completes**, and file goodput rises with the cap: 4.2 KB/s for the one that reads up to P2, 11.0 for P3 and 31.6 for P4.
- **The one-way ladder costs 42% to 71%** of what the best single profile would give (29%, 30% and 58% of the oracle's file goodput): airtime spent on profiles the receiver cannot read is lost, and the dense profiles that hold most of the airtime are the unreadable ones for a weak receiver.
- **After the sender locks, the data rate is 94% and 92% of the single-profile maximum** for the two receivers whose transfer lasted long enough (the third finished before any lock). The 90% criterion is met, with 2 to 4 points to spare, and a beacon frame in 16 alone costs 6%. Whole-transfer goodput is lower, 63% and 43% of the oracle, because the first three seconds are the time to lock (a second of holding the lock, then 30 frames of feedback delay). Short transfers do not benefit: the fastest receiver finished the file in 1.9 s.

## Not measured

- Any real device: the thresholds, the interleave weights, the advice rules and the three-second window.
- Receivers capped at P0 and P1, which need the QR path.
- The feedback delay (30 frames is an assumption), and the feedback frame itself.
- Screen reader behaviour on real devices. The announcement rate is tested in the DOM only.
- The 90% criterion with duplex on a link where profiles change mid-transfer.

## Consequences

- #1146 carries the locked profile number; nothing else of the ladder depends on it.
- Changing a profile's block size or the droplet size changes the benchmark; rerun `pnpm run bench:optical-ladder`.
- If the real-device results show the dense profiles cannot be read, lower their weights: the benchmark's one-way cost is the argument for it.
