import { beforeAll, describe, expect, it } from 'vitest';
import { ProbeRun, drawProbeFrame, formatProbeReport, loadOpticalModem, probeSequence, simulateCapture, type ChannelPreset, type ProbePattern, type RgbaImage } from '../index';

// Split from probe.test.ts (#1608): six captures at 3.2 pixels per cell take seconds alone and ran past
// 30 s on a busy coverage shard. The slow suite runs it when the modem changes, and every night.
const meta = { device: 'synthetic', mode: 'propped' as const, direction: 'test' };
const SESSION = 4242;

function capture(p: ProbePattern, counter: number, preset: ChannelPreset, options: { pixelsPerCell: number }): RgbaImage {
  return simulateCapture(drawProbeFrame(p, SESSION, counter), preset, { pixelsPerCell: options.pixelsPerCell, cellPitch: p.pitch, seed: counter + 1 });
}

beforeAll(() => loadOpticalModem());

describe('probe analysis on synthetic captures', () => {
  it('measures edge sharpness and flicker, and writes a copyable text report', () => {
    const edge = probeSequence().find((p) => p.kind === 'edge');
    const flicker = probeSequence().find((p) => p.kind === 'flicker');
    if (!edge || !flicker) throw new Error('sequence lacks the edge or flicker pattern');
    const sharp = new ProbeRun(meta);
    const soft = new ProbeRun(meta);
    for (let c = 0; c < 2; c++) {
      sharp.ingest(capture(edge, c, 'studio', { pixelsPerCell: 3.2 }), c * 33);
      soft.ingest(capture(edge, c, 'poor', { pixelsPerCell: 3.2 }), c * 33);
      sharp.ingest(capture(flicker, c, 'studio', { pixelsPerCell: 3.2 }), 100 + c * 33);
    }
    const sharpEdge = sharp.report().edges[0];
    const softEdge = soft.report().edges[0];
    expect(softEdge.sigmaCells).toBeGreaterThan(sharpEdge.sigmaCells);
    expect(softEdge.mtf50CyclesPerCell).toBeLessThan(sharpEdge.mtf50CyclesPerCell);
    const [flick] = sharp.report().flicker;
    expect(flick.separation).toBeGreaterThan(0.05);
    expect(flick.fidelity).toBe(1);
    const text = formatProbeReport(sharp.report());
    expect(text).toContain('QRCraftly optical channel probe');
    expect(text).toContain('Device: synthetic');
    expect(text).toContain('slanted edge');
    expect(text).toContain('30 Hz flicker');
  });
});
