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
