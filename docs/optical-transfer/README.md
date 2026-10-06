# Optical Transfer design

These pages describe the architecture, protocol and evidence rules for [Air-Gapped Optical Transfer](../../CONTEXT.md#air-gapped-optical-transfer): sending files from one device's screen to another device's camera, with no network. They record what the code does today separately from what is proposed. They were reviewed against `main` at commit `d473ddfd54e509b824cb302a16813da09dbfb16e` on 2026-10-06.

**Merging these pages changes no code, enables no feature and certifies no speed.** Feature flags, preview switches and defaults stay as they are until an implementation change passes its own review.

## Reading order

| Page                            | What it covers                                                                     | Diagrams |
| ------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| [Architecture](ARCHITECTURE.md) | The privacy boundary, the common transfer engine, ownership and what ships today   | D01–D03  |
| [Protocol](PROTOCOL.md)         | Session admission, turning corruption into erasures, recovery bands and completion | D04–D07  |
| [Receiver](RECEIVER.md)         | The capture and decode path, backpressure and bounded windows for larger files     | D08–D10  |
| [Profiles](PROFILES.md)         | The mandatory compatibility path and capability-based optional extensions          | D11–D13  |
| [Feedback](FEEDBACK.md)         | Which physical arrangements can run duplex, and receiver policies                  | D14–D15  |
| [Performance](PERFORMANCE.md)   | Targets, conditional rate envelopes and metrics with explicit clocks               | D16      |
| [Validation](VALIDATION.md)     | Evidence, coverage, qualification states and the research order                    | D17–D20  |

## Status labels

Every diagram and design section carries one of these:

- **CURRENT**: what the code does at the reviewed commit. A current feature can still be preview-only or behind a build flag; the [implementation inventory](ARCHITECTURE.md#implementation-inventory) says which.
- **PROPOSED**: the intended design. It may need an ADR or a wire-format version decision before it is built.
- **EXPERIMENT**: a candidate to compare, not an accepted architectural choice.

## Evidence labels

Every number carries one of these:

- **Measured-code**: a property of the source, or an elapsed processing time on a named host.
- **Measured-sim**: a modelled display and camera, even when real codecs decode the rendered pixels.
- **Measured-device**: a documented physical sender, receiver and browser. **No device result exists yet**; the [device checklist](../TRANSFER_DEVICE_CHECKLIST.md) is where the first ones will go.
- **Inferred**: a calculation from explicit assumptions.
- **Not measured**: nobody knows yet.

## Diagram conventions

The diagrams are Mermaid, so they stay editable as text and GitHub renders them. Solid arrows are data or execution. Dashed arrows are optional paths or dependency information. Each diagram states its status and an invariant: a rule that holds whatever the implementation looks like. A diagram labelled PROPOSED does not describe shipped behaviour.

## How these pages relate to the rest of the docs

These pages link to the existing documents rather than copying them, and do not redefine accepted wire contracts or repeat measurements that change over time:

- [AGENTS.md](../../AGENTS.md) for the repository invariants (client-side only, the storage allowlist, in-house first, no analytics).
- [CONTEXT.md](../../CONTEXT.md) for the domain vocabulary (Prism Frame, Transfer Manifest, Session ID, Droplet Symbol, Stateless Stream Entry and the rest).
- The ADRs in [docs/adr](../adr/) for accepted decisions. The ones these pages rely on are listed under [Existing authority](ARCHITECTURE.md#existing-authority).
- [TRANSFER_BENCHMARK.md](../TRANSFER_BENCHMARK.md), [OPTICAL_BENCHMARK.md](../OPTICAL_BENCHMARK.md), [OPTICAL_LADDER_BENCHMARK.md](../OPTICAL_LADDER_BENCHMARK.md) and [FEEDBACK_BENCHMARK.md](../FEEDBACK_BENCHMARK.md) for simulator results.
- [TRANSFER_DEVICE_CHECKLIST.md](../TRANSFER_DEVICE_CHECKLIST.md) for device results.
- [OPTICAL_RESEARCH.md](../OPTICAL_RESEARCH.md) for the rolling-shutter, GPU and ladder research notes.
- [ABUSE_PROTECTIONS.md](../ABUSE_PROTECTIONS.md) for receive caps, decompression limits and file-name rules.

When a proposal here is built, its accepted decision goes in a new ADR and the page's status label changes to CURRENT in the same pull request.
