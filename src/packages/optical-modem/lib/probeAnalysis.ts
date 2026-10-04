/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { labDistance, lumaOf, rgbToOklab, type Lab } from './colour';
import { getConstellation } from './constellation';
import { acquireFrame, readDataCells, type AcquireFailure, type AcquiredFrame } from './frame';
import { BAND_ROWS, type RgbaImage } from './layout';
import { EDGE_RUN, PROBE_PROFILE, probeGeometries, probeSequence, probeSymbols, unpackProbeSeq, type ProbePattern } from './probe';

/** Bands the data area is cut into when looking for a tear between two frames. */
const BANDS = 8;
/** A band belongs to a variant when it matches it better than the other by this much. */
const BAND_MARGIN = 0.1;

/** What the receiver knows about its camera, filled in by the page from `getSettings()`. */
export interface ProbeCamera {
  /** Granted capture size. */
  width: number;
  height: number;
  /** Granted frame rate. */
  frameRate: number;
  /** Frames per second the camera actually delivered, counted by the page. */
  deliveredFps?: number;
}

/** Labels the person gives a run; they only appear in the report. */
export interface ProbeMeta {
  device: string;
  mode: 'handheld' | 'propped' | 'unspecified';
  direction: string;
  camera?: ProbeCamera;
}

/** Verdict on one captured grid frame. */
export type FrameStatus = 'clean' | 'torn' | 'blended';

/** One cell-size and constellation configuration, as measured. */
export interface GridResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  clean: number;
  torn: number;
  blended: number;
  /** Cells that differ from what was sent, over clean frames. */
  symbolErrorRate: number;
  /** Mutual information estimate per cell, in bits (plug-in estimate from the confusion matrix). */
  bitsPerCell: number;
  /** The most a cell can carry with this constellation, in bits. */
  maxBitsPerCell: number;
  /** Class separation over spread, in dB, in OKLab: smallest gap between symbol means against the mean deviation. */
  snrDb: number;
  /** Mean size of a cell in the camera image, in pixels: what the camera resolved at this distance. */
  cameraCellPx: number;
  /** Display ticks per second seen in the headers. */
  displayFps: number;
  /** New clean frames per second: min(camera, display) times the clean share. */
  effectiveFps: number;
  /** Information-theoretic capacity in kilobytes (1000 bytes) per second for this configuration. */
  capacityKBps: number;
  /** Mean classification confidence (0 to 255) and its 10th percentile; a drop between frames means motion blur. */
  meanConfidence: number;
  confidenceP10: number;
  /** Counts of expected (row) against read (column) symbols. */
  confusion: number[][];
}

/** A flicker pattern as measured. */
export interface FlickerResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  displayFps: number;
  /** OKLab distance between the two colours as the camera saw them. */
  separation: number;
  /** Share of frames whose colour is nearer the variant the header names than the other. */
  fidelity: number;
}

/** The slanted edge as measured, in cell units. */
export interface EdgeResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  /** Deviation of the line spread, in cells. */
  sigmaCells: number;
  /** Spatial frequency where contrast falls to half, in cycles per cell. */
  mtf50CyclesPerCell: number;
}

/** A finished run. Nothing in it identifies anyone but the labels the person typed. */
export interface ProbeReport {
  meta: ProbeMeta;
  framesAnalysed: number;
  /** Frames that could not be read, by reason. */
  unreadable: Record<string, number>;
  grids: GridResult[];
  flicker: FlickerResult[];
  edges: EdgeResult[];
}

interface GridState {
  pattern: ProbePattern;
  clean: number;
  torn: number;
  blended: number;
  cells: number;
  errors: number;
  confusion: number[][];
  symbolStats: { n: number; sum: [number, number, number]; sumSq: [number, number, number] }[];
  confidences: number[];
  cellPx: number[];
  counters: Set<number>;
  firstTime: number;
  lastTime: number;
  firstCounter: number;
  lastCounter: number;
}

interface FlickerState {
  pattern: ProbePattern;
  frames: { variant: number; lab: Lab }[];
  firstTime: number;
  lastTime: number;
  firstCounter: number;
  lastCounter: number;
}

interface EdgeState {
  pattern: ProbePattern;
  sigmas: number[];
  mtf50s: number[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Plug-in estimate of the mutual information between the symbol sent and the symbol read, with the
 * sent symbols equally likely, from a confusion matrix.
 * @param confusion - Counts, sent symbol by row and read symbol by column.
 * @returns Bits per cell.
 */
export function mutualInformation(confusion: readonly (readonly number[])[]): number {
  const n = confusion.length;
  const rowTotals = confusion.map((row) => row.reduce((s, v) => s + v, 0));
  const active = rowTotals.filter((t) => t > 0).length;
  if (active === 0) return 0;
  const joint = confusion.map((row, x) => row.map((v) => (rowTotals[x] > 0 ? v / rowTotals[x] / active : 0)));
  const read = Array.from({ length: n }, (_, y) => joint.reduce((s, row) => s + row[y], 0));
  let bits = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      if (joint[x][y] > 0) bits += joint[x][y] * Math.log2(joint[x][y] / ((1 / active) * read[y]));
    }
  }
  return bits;
}

/**
 * Edge response of the slanted-edge target: bins samples by distance from the edge, differentiates
 * the step response into a line spread and measures it.
 * @param sample - Luma at a point given in cell coordinates.
 * @param cols - Columns of the frame.
 * @param rows - Rows of the frame.
 * @returns The line spread's deviation and the 50% contrast frequency, or null when the edge was not found.
 */
export function measureEdge(sample: (u: number, v: number) => number, cols: number, rows: number): { sigmaCells: number; mtf50CyclesPerCell: number } | null {
  const binsPerCell = 16;
  const reach = 6;
  const bins = reach * 2 * binsPerCell;
  const sum = new Float64Array(bins);
  const count = new Float64Array(bins);
  const norm = Math.sqrt(1 + 1 / (EDGE_RUN * EDGE_RUN));
  const centreV = (BAND_ROWS + rows - BAND_ROWS) / 2;
  const vStart = BAND_ROWS + 2;
  const vEnd = rows - BAND_ROWS - 2;
  for (let v = vStart; v < vEnd; v += 1 / 4) {
    const edgeU = cols / 2 + (v - centreV) / EDGE_RUN;
    for (let u = cols / 2 - 14; u < cols / 2 + 14; u += 1 / 8) {
      const bin = Math.floor(((u - edgeU) / norm + reach) * binsPerCell);
      if (bin < 0 || bin >= bins) continue;
      sum[bin] += sample(u, v);
      count[bin]++;
    }
  }
  const esf: number[] = [];
  for (let i = 0; i < bins; i++) {
    if (count[i] === 0) return null;
    esf.push(sum[i] / count[i]);
  }
  const lo = mean(esf.slice(0, binsPerCell));
  const hi = mean(esf.slice(-binsPerCell));
  if (Math.abs(hi - lo) < 24) return null;
  const lsf: number[] = [];
  for (let i = 1; i < bins; i++) lsf.push(Math.max(0, (esf[i] - esf[i - 1]) / (hi - lo)));
  const total = lsf.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const centre = lsf.reduce((s, v, i) => s + v * i, 0) / total;
  const variance = lsf.reduce((s, v, i) => s + v * (i - centre) * (i - centre), 0) / total;
  const sigmaCells = Math.sqrt(variance) / binsPerCell;
  let mtf50 = binsPerCell / 2;
  let previous = 1;
  for (let k = 1; k <= bins / 2; k++) {
    const f = k / bins;
    let re = 0;
    let im = 0;
    for (let i = 0; i < lsf.length; i++) {
      re += lsf[i] * Math.cos(2 * Math.PI * f * i);
      im -= lsf[i] * Math.sin(2 * Math.PI * f * i);
    }
    const magnitude = Math.sqrt(re * re + im * im) / total;
    if (magnitude < 0.5) {
      const fPrev = (k - 1) / bins;
      mtf50 = (fPrev + ((previous - 0.5) / (previous - magnitude)) * (f - fPrev)) * binsPerCell;
      break;
    }
    previous = magnitude;
  }
  return { sigmaCells, mtf50CyclesPerCell: mtf50 };
}

function bilinearLuma(image: RgbaImage, x: number, y: number): number {
  const fx = Math.min(image.width - 1.001, Math.max(0, x - 0.5));
  const fy = Math.min(image.height - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (px: number, py: number): number => {
    const i = (py * image.width + px) * 4;
    return lumaOf(image.data[i], image.data[i + 1], image.data[i + 2]);
  };
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

/** Collects what a receiver sees while the sender plays the probe sequence, and turns it into a report. */
export class ProbeRun {
  public meta: ProbeMeta;
  private framesAnalysed = 0;
  private readonly unreadable = new Map<string, number>();
  private readonly grids = new Map<number, GridState>();
  private readonly flicker = new Map<number, FlickerState>();
  private readonly edges = new Map<number, EdgeState>();

  constructor(meta: ProbeMeta) {
    this.meta = meta;
  }

  /**
   * Reads one captured frame and files what it shows.
   * @param image - The captured frame.
   * @param timeMs - When it was captured, in milliseconds on any steady clock.
   * @returns Which pattern the frame showed, or null when it could not be read.
   */
  public ingest(image: RgbaImage, timeMs: number): number | null {
    this.framesAnalysed++;
    const acquired = acquireFrame(image, probeGeometries());
    if (!acquired.ok) return this.reject(acquired.reason);
    const { frame } = acquired;
    if (frame.header.profile !== PROBE_PROFILE) return this.reject('foreign');
    const { patternIndex, counter } = unpackProbeSeq(frame.header.seq);
    const pattern = probeSequence()[patternIndex];
    if (!pattern || pattern.cols !== frame.header.cols || pattern.rows !== frame.header.rows) return this.reject('unknown-pattern');
    if (pattern.kind === 'grid') this.ingestGrid(image, frame, pattern, counter, timeMs);
    else if (pattern.kind === 'flicker') this.ingestFlicker(image, frame, pattern, counter, timeMs);
    else this.ingestEdge(image, frame, pattern);
    return patternIndex;
  }

  private reject(reason: AcquireFailure | 'foreign' | 'unknown-pattern'): null {
    this.unreadable.set(reason, (this.unreadable.get(reason) ?? 0) + 1);
    return null;
  }

  private ingestGrid(image: RgbaImage, frame: AcquiredFrame, pattern: ProbePattern, counter: number, timeMs: number): void {
    const size = getConstellation(pattern.constellation).size;
    let state = this.grids.get(pattern.index);
    if (!state) {
      state = {
        pattern,
        clean: 0,
        torn: 0,
        blended: 0,
        cells: 0,
        errors: 0,
        confusion: Array.from({ length: size }, () => new Array<number>(size).fill(0)),
        symbolStats: Array.from({ length: size }, () => ({ n: 0, sum: [0, 0, 0], sumSq: [0, 0, 0] })),
        confidences: [],
        cellPx: [],
        counters: new Set(),
        firstTime: timeMs,
        lastTime: timeMs,
        firstCounter: counter,
        lastCounter: counter,
      };
      this.grids.set(pattern.index, state);
    }
    state.counters.add(counter);
    state.lastTime = timeMs;
    state.lastCounter = counter;
    state.cellPx.push(cameraCellSize(frame));
    const grid = readDataCells(image, frame);
    const variant = counter & 1;
    const own = probeSymbols(pattern, frame.header.session, variant);
    const other = probeSymbols(pattern, frame.header.session, 1 - variant);
    const rowsPerBand = Math.ceil(frame.layout.dataRows / BANDS);
    const ownHits = new Array<number>(BANDS).fill(0);
    const otherHits = new Array<number>(BANDS).fill(0);
    const cellsInBand = new Array<number>(BANDS).fill(0);
    for (let i = 0; i < grid.symbols.length; i++) {
      const band = Math.min(BANDS - 1, Math.floor(Math.floor(i / frame.layout.cols) / rowsPerBand));
      cellsInBand[band]++;
      if (grid.symbols[i] === own[i]) ownHits[band]++;
      if (grid.symbols[i] === other[i]) otherHits[band]++;
    }
    let ownBands = 0;
    let otherBands = 0;
    let usedBands = 0;
    for (let b = 0; b < BANDS; b++) {
      if (cellsInBand[b] === 0) continue;
      usedBands++;
      const d = (ownHits[b] - otherHits[b]) / cellsInBand[b];
      if (d > BAND_MARGIN) ownBands++;
      else if (d < -BAND_MARGIN) otherBands++;
    }
    const status: FrameStatus = otherBands === 0 && ownBands === usedBands ? 'clean' : ownBands > 0 && otherBands > 0 ? 'torn' : 'blended';
    state[status]++;
    if (status !== 'clean') return;
    let confidence = 0;
    for (let i = 0; i < grid.symbols.length; i++) {
      state.cells++;
      confidence += grid.confidence[i];
      state.confusion[own[i]][grid.symbols[i]]++;
      if (grid.symbols[i] !== own[i]) state.errors++;
      if (i % 4 === 0) {
        const lab = rgbToOklab([grid.means[i * 3], grid.means[i * 3 + 1], grid.means[i * 3 + 2]]);
        const stats = state.symbolStats[own[i]];
        stats.n++;
        for (let c = 0; c < 3; c++) {
          stats.sum[c] += lab[c];
          stats.sumSq[c] += lab[c] * lab[c];
        }
      }
    }
    state.confidences.push(confidence / grid.symbols.length);
  }

  private ingestFlicker(image: RgbaImage, frame: AcquiredFrame, pattern: ProbePattern, counter: number, timeMs: number): void {
    const state = this.flicker.get(pattern.index) ?? { pattern, frames: [], firstTime: timeMs, lastTime: timeMs, firstCounter: counter, lastCounter: counter };
    this.flicker.set(pattern.index, state);
    state.lastTime = timeMs;
    state.lastCounter = counter;
    const { means } = readDataCells(image, frame);
    let r = 0;
    let g = 0;
    let b = 0;
    const cells = means.length / 3;
    for (let i = 0; i < cells; i++) {
      r += means[i * 3];
      g += means[i * 3 + 1];
      b += means[i * 3 + 2];
    }
    state.frames.push({ variant: counter & 1, lab: rgbToOklab([r / cells, g / cells, b / cells]) });
  }

  private ingestEdge(image: RgbaImage, frame: AcquiredFrame, pattern: ProbePattern): void {
    const h = frame.homography;
    const sample = (u: number, v: number): number => {
      const w = h[6] * u + h[7] * v + 1;
      return bilinearLuma(image, (h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w);
    };
    const state = this.edges.get(pattern.index) ?? { pattern, sigmas: [], mtf50s: [] };
    this.edges.set(pattern.index, state);
    const measured = measureEdge(sample, pattern.cols, pattern.rows);
    if (measured) {
      state.sigmas.push(measured.sigmaCells);
      state.mtf50s.push(measured.mtf50CyclesPerCell);
    }
  }

  /**
   * Summarises everything seen so far.
   * @returns The report.
   */
  public report(): ProbeReport {
    const cameraFps = this.meta.camera?.deliveredFps;
    const grids = [...this.grids.values()]
      .sort((a, b) => a.pattern.index - b.pattern.index)
      .map((s): GridResult => {
        const analysed = s.clean + s.torn + s.blended;
        const elapsed = Math.max(1, s.lastTime - s.firstTime) / 1000;
        const displayFps = s.counters.size > 1 ? (s.lastCounter - s.firstCounter) / elapsed : 0;
        const received = cameraFps ?? analysed / elapsed;
        const effectiveFps = analysed > 0 ? Math.min(received, displayFps || received) * (s.clean / analysed) : 0;
        const bitsPerCell = mutualInformation(s.confusion);
        const size = s.confusion.length;
        const means = s.symbolStats.map((st) => (st.n ? [st.sum[0] / st.n, st.sum[1] / st.n, st.sum[2] / st.n] : null));
        let gap = Infinity;
        for (let a = 0; a < size; a++) {
          for (let b = a + 1; b < size; b++) {
            const ma = means[a];
            const mb = means[b];
            if (ma && mb) gap = Math.min(gap, labDistance([ma[0], ma[1], ma[2]], [mb[0], mb[1], mb[2]]));
          }
        }
        const spreads = s.symbolStats.filter((st) => st.n > 1).map((st) => {
          let variance = 0;
          for (let c = 0; c < 3; c++) variance += st.sumSq[c] / st.n - (st.sum[c] / st.n) ** 2;
          return Math.max(0, variance / 3);
        });
        const sigma = Math.sqrt(mean(spreads));
        const snrDb = Number.isFinite(gap) && sigma > 0 ? 20 * Math.log10(gap / 2 / sigma) : 0;
        const cells = dataCellCount(s.pattern);
        return {
          pattern: s.pattern,
          framesAnalysed: analysed,
          clean: s.clean,
          torn: s.torn,
          blended: s.blended,
          symbolErrorRate: s.cells ? s.errors / s.cells : 1,
          bitsPerCell,
          maxBitsPerCell: Math.log2(size),
          snrDb,
          cameraCellPx: mean(s.cellPx),
          displayFps,
          effectiveFps,
          capacityKBps: (bitsPerCell * cells * effectiveFps) / 8 / 1000,
          meanConfidence: mean(s.confidences),
          confidenceP10: percentile(s.confidences, 0.1),
          confusion: s.confusion,
        };
      });
    const flicker = [...this.flicker.values()]
      .sort((a, b) => a.pattern.index - b.pattern.index)
      .map((s): FlickerResult => {
        const mean0 = meanLab(s.frames.filter((f) => f.variant === 0).map((f) => f.lab));
        const mean1 = meanLab(s.frames.filter((f) => f.variant === 1).map((f) => f.lab));
        const hits = s.frames.filter((f) => labDistance(f.lab, f.variant === 0 ? mean0 : mean1) <= labDistance(f.lab, f.variant === 0 ? mean1 : mean0)).length;
        const elapsed = Math.max(1, s.lastTime - s.firstTime) / 1000;
        return {
          pattern: s.pattern,
          framesAnalysed: s.frames.length,
          displayFps: (s.lastCounter - s.firstCounter) / elapsed,
          separation: labDistance(mean0, mean1),
          fidelity: s.frames.length ? hits / s.frames.length : 0,
        };
      });
    const edges = [...this.edges.values()].map((s): EdgeResult => ({ pattern: s.pattern, framesAnalysed: s.sigmas.length, sigmaCells: mean(s.sigmas), mtf50CyclesPerCell: mean(s.mtf50s) }));
    return { meta: this.meta, framesAnalysed: this.framesAnalysed, unreadable: Object.fromEntries(this.unreadable), grids, flicker, edges };
  }
}

/** Size of one cell in the camera image around the middle of the frame, from the homography. */
function cameraCellSize(frame: AcquiredFrame): number {
  const h = frame.homography;
  const map = (u: number, v: number): [number, number] => {
    const w = h[6] * u + h[7] * v + 1;
    return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
  };
  const u = frame.layout.cols / 2;
  const v = frame.layout.rows / 2;
  const [px, py] = map(u, v);
  const [qx, qy] = map(u + 1, v);
  const [rx, ry] = map(u, v + 1);
  return Math.sqrt(Math.abs((qx - px) * (ry - py) - (qy - py) * (rx - px)));
}

function dataCellCount(pattern: ProbePattern): number {
  return pattern.cols * (pattern.rows - 2 * BAND_ROWS);
}

function meanLab(labs: Lab[]): Lab {
  if (!labs.length) return [0, 0, 0];
  return [mean(labs.map((l) => l[0])), mean(labs.map((l) => l[1])), mean(labs.map((l) => l[2]))];
}

/**
 * Writes a report as plain text for copying. Nothing is sent anywhere.
 * @param report - A finished run.
 * @returns The text.
 */
export function formatProbeReport(report: ProbeReport): string {
  const { meta } = report;
  const lines: string[] = ['QRCraftly optical channel probe', `Device: ${meta.device || 'unlabelled'}`, `Direction: ${meta.direction || 'unlabelled'}`, `Mode: ${meta.mode}`];
  if (meta.camera) {
    lines.push(`Camera granted: ${meta.camera.width} x ${meta.camera.height} at ${meta.camera.frameRate} fps`);
    if (meta.camera.deliveredFps !== undefined) lines.push(`Camera delivered: ${meta.camera.deliveredFps.toFixed(1)} fps`);
  }
  lines.push(`Frames analysed: ${report.framesAnalysed}`);
  const unreadable = Object.entries(report.unreadable);
  if (unreadable.length) lines.push(`Unreadable: ${unreadable.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push('', 'Grids (pitch, constellation | camera px per cell | clean/torn/blended | SER | bits per cell of max | SNR dB | display fps | capacity KB/s)');
  for (const g of report.grids) {
    lines.push(
      `${g.pattern.label} | ${g.cameraCellPx.toFixed(1)} | ${g.clean}/${g.torn}/${g.blended} | ${(g.symbolErrorRate * 100).toFixed(2)}% | ${g.bitsPerCell.toFixed(2)} of ${g.maxBitsPerCell} | ${g.snrDb.toFixed(1)} | ${g.displayFps.toFixed(1)} | ${g.capacityKBps.toFixed(1)}`
    );
  }
  if (report.edges.length) {
    lines.push('', 'Slanted edge (line spread deviation in cells, MTF50 in cycles per cell)');
    for (const e of report.edges) lines.push(`${e.pattern.label} | ${e.sigmaCells.toFixed(3)} | ${e.mtf50CyclesPerCell.toFixed(2)}`);
  }
  if (report.flicker.length) {
    lines.push('', 'Flicker (display fps seen | OKLab separation | variant fidelity)');
    for (const f of report.flicker) lines.push(`${f.pattern.label} | ${f.displayFps.toFixed(1)} | ${f.separation.toFixed(3)} | ${(f.fidelity * 100).toFixed(0)}%`);
  }
  return lines.join('\n');
}
