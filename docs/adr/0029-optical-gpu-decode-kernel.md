---
status: proposed
---

# Optical GPU Decode Kernel

## Context

The optical modem ([ADR 0028](0028-optical-modem-frame-format.md)) reads a frame by sampling every data cell through a homography and matching its colour to the frame's own calibration patches. At the sizes QRCraftly Optical (#1161) aims for, such as 512 x 288 cells at 60 frames per second, that is about 9 million cell classifications a second, nine pixel reads each. The main thread cannot do that, and a CPU worker is doubtful on a phone. This decision (issue #1164) puts that step on the GPU and fixes the rule that keeps it honest: the GPU must give the bytes the reference kernel gives.

Nothing here has been run on a phone GPU. What was run is stated in [Measured](#measured) and what was not in [Not measured](#not-measured).

## Decision

### What moves to the GPU

Only the per-cell kernel. For each data cell it takes nine nearest-pixel samples through the homography, averages them, finds the nearest of the frame's palette colours and a confidence, and writes the symbol, the confidence and (for tests) the mean colour. This is `sampleCell` and `classifyColour` in the package, and `runReferenceKernel` is the definition of correct. The inner code, the outer code and the header stay on the CPU, in a worker, and so do these:

- **Finding the frame** (fiducial search, homography, header, palette). It works on a full luma image and costs a few hundred operations per frame, so it is cheap next to the kernel. It is also the part that needs the frame on the CPU. A receiver that reads back the whole camera frame gives up part of the zero-copy gain. A GPU fiducial search with frame-to-frame tracking, as the issue describes, is **not built**. It is the next step, and it needs its own conformance rule, because a search is not a per-cell map.
- **Palette read**. Black, white and symbol patches are read by the CPU from the same frame.

### The conformance rule

The GPU output is the reference output, byte for byte: symbol, confidence and mean colour of every cell. Three things enforce this.

- **Integer arithmetic where it is rounded.** Pixel sums, the mean (`(sum + 4) / 9`), the squared distances and the confidence are integers, which a GPU computes exactly. The pixel values are read from an 8-bit texture with `texelFetch`, never filtered.
- **Only `+ - * /` on 32-bit floats for the homography**, in the same order as the reference, which the package already required ([ADR 0028, Determinism](0028-optical-modem-frame-format.md#determinism)). The shader uses no built-in that is allowed to differ between implementations (a test checks the source).
- **A self-test on the device.** The floating-point part is the one place equality is not guaranteed by the language. GLSL ES does not promise IEEE rounding for division, and a compiler may fuse a multiply and an add. So the receiver runs `createVerifiedGpuKernel`, which runs noise frames of 4, 8 and 16 colours through the GPU kernel and the reference kernel and keeps the GPU only when every byte matches. Noise puts many sample positions close to a pixel boundary, which is where a rounding difference would show. When it does not match, the receiver stays on the CPU and says why (`not-bit-exact`). The conformance is therefore enforced on every device at run time, not assumed from one test machine.

### Fallback

- WebGL 2 is the one path built. WebGPU compute is **not** built: the kernel is a per-cell map with no shared memory or reductions, so WebGL 2 fragment shaders do the same work, and WebGL 2 reaches more browsers today. WebGPU is the choice to revisit if a GPU fiducial search needs compute.
- With no WebGL 2, a shader that fails to compile, a lost context or a failed self-test, the receiver keeps the QR profiles of the ladder ([ADR 0030](0030-optical-profile-ladder.md)) and shows one of four fixed messages (`GPU_FALLBACK_MESSAGES`), each ending in "QR profiles still work".
- A JavaScript worker running the reference kernel is also a valid CPU path. It is not wired in here.

### Frame source

`watchFrames` uses `requestVideoFrameCallback` where the video element has it, which fires per presented camera frame, and `requestAnimationFrame` otherwise. `FrameRateMeter` reports delivered frames per second and dropped frames, from the callback's `presentedFrames`. `grantedSettings` reads the resolution and frame rate the camera granted. The kernel takes a raw RGBA array or any WebGL texture source (a video element, an `ImageBitmap`, a canvas, a `VideoFrame`), which the browser can upload without a copy through the CPU.

The conformance rule starts at RGBA pixels. How a browser converts a camera's video format to RGBA, and whether it applies colour management on the way, is the browser's, differs between engines, and is outside what this kernel can promise. The upload turns off premultiplication and colour-space conversion, which is all the page can do. A receiver is therefore reproducible from RGBA pixels, not from a camera.

### Under the site's CSP

The shader is compiled by the graphics driver from a string, which is not JavaScript `eval`; it needs no `unsafe-eval`, no worker, no `blob:` script and no network. No change to the policy is needed, and `docs/SECURITY.md` is unchanged. This was checked in a headless Chromium with the site's base policy enforced and the inline-script allowance removed, as production does (see below).

### Where it lives

`src/packages/optical-modem/gpu.ts` is a separate entry point, so code that imports the package root never pulls in the GL code. The root exports the reference kernel, the shader source, the frame source and the `sampleGrid` hook of `decodeModemFrame`, which is how a GPU result enters the decoder. Nothing in the shipped app imports either entry; both are behind `VITE_OPTICAL_MODEM` like the rest of the modem, and neither adds to any page's first load.

## Measured

`pnpm run bench:optical-gpu` bundles the GPU path, loads it in a headless Chromium and compares it with the reference kernel in Node. Software rendering (SwiftShader) is the only WebGL 2 available in the sandbox: Chrome for Testing 147 headless shell, ANGLE with SwiftShader on Vulkan, on a 4-core machine shared with other jobs.

- **Bit-exactness.** 129,360 cells of 18 simulated frames (profiles 2 to 4, studio, typical and poor channels, two cell sizes each) and 12,480 cells of noise frames: 0 mismatching symbols, confidences or mean colours. Decoding through the GPU result gives the same blocks, block for block, as the reference decode in all 18 frames. A negative control (GPU homography nudged by 0.4 pixel) differs on 3,437 of 5,880 cells, so the comparison can see a difference.
- **CSP.** Under `script-src 'self' 'wasm-unsafe-eval'` (the site's base policy without `'unsafe-inline'`), the kernel builds, the self-test is exact and there are no violations.
- **Speed on the software rasterizer** (upload, draw and read-back of symbols, confidences and means, per frame, 1920 x 1080 noise frame, 8 colours; medians over 10 to 20 runs, which varied by about 30% between runs on the loaded machine):
  - 120 x 49 data cells (profile 3): about 3 to 4 ms; the reference kernel in Node: about 2.4 ms.
  - 512 x 270 data cells (the issue's grid): about 40 to 54 ms; the reference kernel in Node: about 56 to 60 ms.

  These say how the shader behaves on a CPU pretending to be a GPU. They are **not** a GPU speed and say nothing about whether a phone reaches 60 fps.

## Not measured

- Any real GPU: desktop, Android or iPhone. Whether the shader compiles, is bit-exact and meets the 60 fps budget there is unknown; the on-device self-test exists because it cannot be assumed.
- The 60 fps at 512 x 288 acceptance criterion on a mid-range Android, and the iPhone result.
- Long tasks over 50 ms on the main thread during a transfer. WebGL calls are asynchronous in the browser, but `readPixels` waits for the GPU; a receiver that cares reads back through a pixel buffer object or a fence, which is not built.
- A camera frame uploaded as a `VideoFrame` or video element. Only RGBA arrays were run.
- WebGPU.
- GPU fiducial search and tracking.

## Consequences

- A receiver picks the kernel at start: `createVerifiedGpuKernel` first, the reference kernel otherwise. Both go through `decodeModemFrame`'s `sampleGrid` hook, so the decoder is the same.
- Any change to the reference kernel (`crates/modem/src/sample.rs` since #1198, `sample.ts` before), the shader or the palette format must keep `pnpm run bench:optical-gpu` at zero mismatches, and the unit tests pin what can be pinned without a GPU (the shader source, the upload and read-back calls, the self-test logic).
- The device table in [ADR 0027](0027-optical-channel-probe.md) is where real-device GPU results belong once someone runs the page on phones.
