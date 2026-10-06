import { beforeAll, describe, expect, it } from 'vitest';
import {
  ProbeRun,
  constellationId,
  drawProbeFrame,
  formatProbeReport,
  getConstellation,
  probeGeometries,
  probeSequence,
  simulateCapture,
  type ChannelPreset,
  type ProbePattern,
  type RgbaImage,
  loadOpticalModem,
} from '../index';

const meta = { device: 'synthetic', mode: 'propped' as const, direction: 'test' };
const SESSION = 4242;

function pattern(pitch: number, label: string): ProbePattern {
  const found = probeSequence().find((p) => p.pitch === pitch && p.label.includes(label));
  if (!found) throw new Error(`no pattern ${pitch} ${label}`);
  return found;
}

/** A capture with the camera seeing `pixelsPerCell` pixels per cell (half the device pixels of the pattern by default, which keeps the tests quick). */
function capture(p: ProbePattern, counter: number, preset: ChannelPreset, options: { pixelsPerCell?: number; seed?: number } = {}): RgbaImage {
  return simulateCapture(drawProbeFrame(p, SESSION, counter), preset, { pixelsPerCell: options.pixelsPerCell ?? p.pitch * 0.5, cellPitch: p.pitch, seed: options.seed ?? counter + 1 });
}

/** The first frame with its data area replaced by the mean of both: an exposure that straddled two display frames. */
function blendData(a: RgbaImage, b: RgbaImage, p: ProbePattern): RgbaImage {
  const data = a.data.slice();
  const from = 9 * p.pitch * a.width * 4;
  const to = (p.rows - 9) * p.pitch * a.width * 4;
  for (let i = from; i < to; i++) data[i] = (a.data[i] + b.data[i]) / 2;
  return { width: a.width, height: a.height, data };
}

beforeAll(() => loadOpticalModem());

describe('constellations', () => {
  it('spaces the OKLab designs further apart than the RGB corners', () => {
    for (const size of [4, 8, 16] as const) {
      const rgb = getConstellation(constellationId(size, 'rgb'));
      const oklab = getConstellation(constellationId(size, 'oklab'));
      expect(rgb.symbols).toHaveLength(size);
      expect(oklab.symbols).toHaveLength(size);
      expect(oklab.minDistance).toBeGreaterThan(rgb.minDistance);
    }
  });

  it('is deterministic and rejects unknown ids', () => {
    const first = getConstellation(constellationId(8, 'oklab')).symbols.map((s) => s.join(','));
    expect(first).toEqual(getConstellation(constellationId(8, 'oklab')).symbols.map((s) => s.join(',')));
    expect(() => getConstellation(0)).toThrow();
    expect(() => getConstellation(15)).toThrow();
  });
});

describe('probe sequence', () => {
  it('is fixed, numbered in order and fits every pattern in the receiver geometry list', () => {
    const sequence = probeSequence();
    expect(sequence.map((p) => p.index)).toEqual(sequence.map((_, i) => i));
    const geometries = probeGeometries();
    for (const p of sequence) expect(geometries).toContainEqual({ cols: p.cols, rows: p.rows });
    const pitches = new Set(sequence.filter((p) => p.kind === 'grid').map((p) => p.pitch));
    expect([...pitches].sort((a, b) => b - a)).toEqual([8, 6, 5, 4, 3, 2]);
    expect(sequence.filter((p) => p.kind === 'flicker').map((p) => p.hz)).toEqual([30, 60, 120, 30, 60, 120]);
  });

  it('draws the same frame every time, and different data in the two variants', { timeout: 60000 }, () => {
    const p = pattern(8, 'monochrome');
    const a = drawProbeFrame(p, SESSION, 0);
    expect(drawProbeFrame(p, SESSION, 0).data).toEqual(a.data);
    expect(drawProbeFrame(p, SESSION, 1).data).not.toEqual(a.data);
    expect(drawProbeFrame(p, SESSION, 2).data).not.toEqual(drawProbeFrame(p, SESSION + 1, 2).data);
  });

  it('keeps both flicker colours under the WCAG general flash threshold', () => {
    const luminance = (rgb: number[]): number => {
      const lin = rgb.map((v) => ((v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)));
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };
    for (const p of probeSequence().filter((q) => q.kind === 'flicker')) {
      const at = (counter: number): number[] => {
        const frame = drawProbeFrame(p, SESSION, counter);
        const i = ((Math.floor(frame.height / 2) * frame.width) + Math.floor(frame.width / 2)) * 4;
        return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
      };
      expect(Math.abs(luminance(at(0)) - luminance(at(1)))).toBeLessThan(0.1);
      expect(at(0)).not.toEqual(at(1));
    }
  });
});

describe('probe analysis on synthetic captures', () => {
  it('reads a propped, sharp capture without errors and reports bits per cell and capacity', { timeout: 60000 }, () => {
    const p = pattern(8, 'monochrome');
    const run = new ProbeRun({ ...meta, camera: { width: 1920, height: 1080, frameRate: 60, deliveredFps: 30 } });
    for (let c = 0; c < 4; c++) expect(run.ingest(capture(p, c, 'studio'), c * 33)).toBe(p.index);
    const [grid] = run.report().grids;
    expect(grid.clean).toBe(4);
    expect(grid.symbolErrorRate).toBeLessThan(0.01);
    expect(grid.bitsPerCell).toBeGreaterThan(0.95);
    expect(grid.maxBitsPerCell).toBe(1);
    expect(grid.cameraCellPx).toBeGreaterThan(3.6);
    expect(grid.cameraCellPx).toBeLessThan(4.4);
    expect(grid.capacityKBps).toBeGreaterThan(0);
    expect(grid.snrDb).toBeGreaterThan(10);
  });

  it('finds that denser colour costs bits when the channel is poor', { timeout: 120000 }, () => {
    const dense = pattern(8, '8 colours, OKLab');
    const good = new ProbeRun(meta);
    const bad = new ProbeRun(meta);
    for (let c = 0; c < 2; c++) {
      good.ingest(capture(dense, c, 'studio', { pixelsPerCell: 3.2 }), c * 33);
      bad.ingest(capture(dense, c, 'typical', { pixelsPerCell: 3.2 }), c * 33);
    }
    const g = good.report().grids[0];
    const b = bad.report().grids[0];
    expect(g.clean).toBeGreaterThan(0);
    expect(g.bitsPerCell).toBeGreaterThan(1.5);
    expect(b.bitsPerCell).toBeLessThan(g.bitsPerCell);
    expect(b.symbolErrorRate).toBeGreaterThan(g.symbolErrorRate);
  });

  it('tells a screen refresh during readout (torn) and a blend of two frames from a clean frame', { timeout: 120000 }, () => {
    const p = pattern(8, 'monochrome');
    const first = drawProbeFrame(p, SESSION, 0);
    const second = drawProbeFrame(p, SESSION, 1);
    const run = new ProbeRun(meta);
    run.ingest(simulateCapture(first, 'studio', { pixelsPerCell: 4, cellPitch: 8 }), 0);
    run.ingest(simulateCapture(first, 'studio', { pixelsPerCell: 4, cellPitch: 8, next: second, tearFraction: 0.6 }), 33);
    run.ingest(simulateCapture(blendData(first, second, p), 'studio', { pixelsPerCell: 4, cellPitch: 8 }), 66);
    const [grid] = run.report().grids;
    expect(grid.clean).toBe(1);
    expect(grid.torn).toBe(1);
    expect(grid.blended).toBe(1);
  });

  it('counts display ticks from the header counters', { timeout: 60000 }, () => {
    const p = pattern(8, 'monochrome');
    const run = new ProbeRun(meta);
    // Counters 0, 2, 4, 6 seen every 100 ms: the display ticked at 20 Hz.
    [0, 2, 4, 6].forEach((counter, i) => run.ingest(drawProbeFrame(p, SESSION, counter), i * 100));
    expect(run.report().grids[0].displayFps).toBeCloseTo(20, 0);
  });

  it('survives a damaged header and reports unreadable frames', { timeout: 60000 }, () => {
    const p = pattern(8, 'monochrome');
    const frame = drawProbeFrame(p, SESSION, 0);
    const damaged: RgbaImage = { ...frame, data: frame.data.slice() };
    // Wipe every 6th column of header cells in the top band: far fewer wrong bytes than the code repairs.
    for (let col = 9; col < p.cols - 9; col += 6) {
      for (let y = 5 * p.pitch; y < 9 * p.pitch; y++) {
        for (let x = col * p.pitch; x < (col + 1) * p.pitch; x++) damaged.data.fill(128, (y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3);
      }
    }
    const run = new ProbeRun(meta);
    expect(run.ingest(damaged, 0)).toBe(p.index);
    const blank: RgbaImage = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(200) };
    expect(run.ingest(blank, 33)).toBeNull();
    const report = run.report();
    expect(report.framesAnalysed).toBe(2);
    expect(report.unreadable['no-fiducials']).toBe(1);
  });

  it('measures edge sharpness and flicker, and writes a copyable text report', { timeout: 120000 }, () => {
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

  it('gives the same capture for the same seed', { timeout: 60000 }, () => {
    const p = pattern(8, 'monochrome');
    expect(capture(p, 0, 'typical', { seed: 9 }).data).toEqual(capture(p, 0, 'typical', { seed: 9 }).data);
    expect(capture(p, 0, 'typical', { seed: 9 }).data).not.toEqual(capture(p, 0, 'typical', { seed: 10 }).data);
  });
});
