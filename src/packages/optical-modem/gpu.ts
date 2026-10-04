/**
 * The GPU decode path of the optical modem (#1164): a WebGL 2 kernel that must agree bit for bit
 * with the reference kernel in the package root. A
 * separate entry point, so nothing that imports the root pulls the GL code in. Experimental: behind
 * the flag in `./flag`, and loaded only by code that has checked it.
 */

export {
  createGpuKernel,
  createVerifiedGpuKernel,
  selfTestGpuKernel,
  GPU_FALLBACK_MESSAGES,
  type GpuCanvas,
  type GpuKernel,
  type GpuKernelResult,
  type GpuFallbackReason,
  type GpuFrameSource,
  type GpuSelfTest,
} from './lib/gpu';
