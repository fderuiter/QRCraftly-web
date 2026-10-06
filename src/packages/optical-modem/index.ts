/**
 * Optical Modem: the colour modem frame, its channel simulator and the capacity probe behind
 * QRCraftly Optical (#1161). Experimental: nothing in the shipped app calls it unless the build
 * turns the flag in `./flag` on.
 */

export { getConstellation, constellationId, type Constellation, type ConstellationSpace } from './lib/constellation';
export { simulateCapture, type ChannelPreset, type CaptureOptions } from './lib/channel';
export { probeSequence, probeGeometries, drawProbeFrame, type ProbePattern } from './lib/probe';
export {
  ProbeRun,
  formatProbeReport,
  type ProbeCamera,
  type ProbeMeta,
  type ProbeReport,
  type GridResult,
  type FlickerResult,
  type EdgeResult,
} from './lib/probeAnalysis';
export type { RgbaImage } from './lib/layout';
export {
  encodeModemFrame,
  decodeModemFrame,
  frameCapacity,
  DEFAULT_ERASURE_THRESHOLD,
  type DecodeOptions,
  type DecodedFrame,
  type FrameCapacity,
} from './lib/codec';
export { MODEM_PROFILES, type ModemProfile } from './lib/profile';
export {
  KERNEL_MAX_SYMBOLS,
  runReferenceKernel,
  compareGrids,
  type KernelUniforms,
  type GridDifference,
} from './lib/kernel';
export type { SampledGrid } from './lib/kernel';
export { loadModemKernels as loadOpticalModem } from './lib/kernels';
export { FRAGMENT_SHADER, VERTEX_SHADER } from './lib/shader';
export { grantedSettings, watchFrames, FrameRateMeter, type StreamGrant, type FrameTick, type FrameWatcher } from './lib/frameSource';
export {
  LADDER,
  DEFAULT_LADDER_WEIGHTS,
  LINK_ADVICE_TEXT,
  LinkTracker,
  SIMULATED_RECEIVERS,
  ladderSchedule,
  lockedSchedule,
  observeDecode,
  linkLabel,
  lockLevelText,
  type LadderRung,
  type FrameObservation,
  type LinkAdvice,
  type LinkState,
  type SimulatedReceiver,
} from './lib/ladder';
