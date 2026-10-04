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

import { lumaOf } from './colour';
import type { RgbaImage } from './layout';

/** A point in image pixels; pixel `(i, j)` covers `[i, i + 1) x [j, j + 1)`. */
export interface Point {
  x: number;
  y: number;
}

interface Blob {
  area: number;
  sumX: number;
  sumY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Four fiducial centres in clockwise order, the one with the biggest core mark first. */
export interface FiducialSearch {
  /** Centres, clockwise on screen. Index 0 is the fiducial the core marks suggest is top-left. */
  points: Point[];
  /** Dark core area of each fiducial in pixels, in the same order. */
  coreAreas: number[];
}

function otsuThreshold(luma: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  let total = 0;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sumAll += i * hist[i];
  }
  let weightBack = 0;
  let sumBack = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    weightBack += hist[t];
    if (weightBack === 0) continue;
    const weightFront = total - weightBack;
    if (weightFront === 0) break;
    sumBack += t * hist[t];
    const meanBack = sumBack / weightBack;
    const meanFront = (sumAll - sumBack) / weightFront;
    const between = weightBack * weightFront * (meanBack - meanFront) * (meanBack - meanFront);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function labelDark(luma: Uint8Array, width: number, height: number, threshold: number): Blob[] {
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const blobs: Blob[] = [];
  for (let start = 0; start < luma.length; start++) {
    if (seen[start] || luma[start] > threshold) continue;
    const blob: Blob = { area: 0, sumX: 0, sumY: 0, minX: width, maxX: 0, minY: height, maxY: 0 };
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const at = stack[--top];
      const x = at % width;
      const y = (at - x) / width;
      blob.area++;
      blob.sumX += x + 0.5;
      blob.sumY += y + 0.5;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      if (x > 0 && !seen[at - 1] && luma[at - 1] <= threshold) {
        seen[at - 1] = 1;
        stack[top++] = at - 1;
      }
      if (x < width - 1 && !seen[at + 1] && luma[at + 1] <= threshold) {
        seen[at + 1] = 1;
        stack[top++] = at + 1;
      }
      if (y > 0 && !seen[at - width] && luma[at - width] <= threshold) {
        seen[at - width] = 1;
        stack[top++] = at - width;
      }
      if (y < height - 1 && !seen[at + width] && luma[at + width] <= threshold) {
        seen[at + width] = 1;
        stack[top++] = at + width;
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

interface RingCandidate {
  centre: Point;
  area: number;
  coreArea: number;
}


/**
 * Among the ring candidates, the four of similar size that span the most area. The fiducials sit at
 * the extreme corners of the frame, so a clump of dark data cells that happens to look like a ring
 * loses to them.
 */
function bestQuad(candidates: RingCandidate[]): RingCandidate[] | null {
  const pool = candidates.sort((a, b) => b.area - a.area).slice(0, 40);
  let best: RingCandidate[] | null = null;
  let bestSpan = 0;
  const n = pool.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (pool[a].area > 1.7 * pool[b].area) break;
      for (let c = b + 1; c < n; c++) {
        if (pool[a].area > 1.7 * pool[c].area) break;
        for (let d = c + 1; d < n; d++) {
          if (pool[a].area > 1.7 * pool[d].area) break;
          const quad = [pool[a], pool[b], pool[c], pool[d]];
          const span = quadSpan(quad.map((q) => q.centre));
          if (span > bestSpan) {
            bestSpan = span;
            best = quad;
          }
        }
      }
    }
  }
  return best;
}

/** Orders four items clockwise on screen (image rows grow downwards), by comparing directions from their mean. */
function clockwise<T>(items: T[], at: (item: T) => Point): T[] {
  const mid = { x: items.reduce((s, i) => s + at(i).x, 0) / items.length, y: items.reduce((s, i) => s + at(i).y, 0) / items.length };
  const half = (i: T): number => (at(i).y - mid.y < 0 ? 0 : 1);
  return items.slice().sort((a, b) => {
    if (half(a) !== half(b)) return half(a) - half(b);
    const cross = (at(a).x - mid.x) * (at(b).y - mid.y) - (at(a).y - mid.y) * (at(b).x - mid.x);
    return cross > 0 ? -1 : cross < 0 ? 1 : 0;
  });
}

/** Area of the convex quadrilateral through four points, or 0 when they are not in convex position. */
function quadSpan(points: Point[]): number {
  const sorted = clockwise(points, (p) => p);
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = sorted[i];
    const q = sorted[(i + 1) % 4];
    const turn = (q.x - p.x) * (sorted[(i + 2) % 4].y - q.y) - (q.y - p.y) * (sorted[(i + 2) % 4].x - q.x);
    if (turn <= 0) return 0;
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Finds the four corner fiducials: dark rings with a hollow centre, optionally holding a dark core
 * whose area tells which corner is which.
 * @param image - The captured frame.
 * @returns The centres in clockwise order, or null when four similar rings are not found.
 */
export function locateFiducials(image: RgbaImage): FiducialSearch | null {
  const { width, height, data } = image;
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) luma[i] = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const threshold = otsuThreshold(luma);
  const blobs = labelDark(luma, width, height, threshold);
  const candidates: RingCandidate[] = [];
  for (const blob of blobs) {
    const w = blob.maxX - blob.minX + 1;
    const h = blob.maxY - blob.minY + 1;
    if (blob.area < 20 || w < 8 || h < 8 || w > 2 * h || h > 2 * w) continue;
    const fill = blob.area / (w * h);
    if (fill < 0.15 || fill > 0.75) continue;
    // A ring is 24 cells and spans 7 to 10 cells whichever way it is turned.
    const cell = Math.sqrt(blob.area / 24);
    if (w < 6.2 * cell || h < 6.2 * cell || w > 11 * cell || h > 11 * cell) continue;
    const cx = blob.sumX / blob.area;
    const cy = blob.sumY / blob.area;
    const reach = 0.2 * Math.max(w, h);
    let coreArea = 0;
    let coreFound = false;
    let nearest = Infinity;
    for (const other of blobs) {
      if (other === blob || other.area >= blob.area * 0.7 || other.area < 0.03 * blob.area) continue;
      const dx = other.sumX / other.area - cx;
      const dy = other.sumY / other.area - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < reach && distance < nearest) {
        nearest = distance;
        coreArea = other.area;
        coreFound = true;
      }
    }
    if (!coreFound) continue;
    candidates.push({ centre: { x: cx, y: cy }, area: blob.area, coreArea });
  }
  const group = bestQuad(candidates);
  if (!group) return null;
  const ordered4 = clockwise(group, (c) => c.centre);
  let first = 0;
  for (let i = 1; i < 4; i++) if (ordered4[i].coreArea > ordered4[first].coreArea) first = i;
  const ordered = [0, 1, 2, 3].map((i) => ordered4[(first + i) % 4]);
  return { points: ordered.map((c) => c.centre), coreAreas: ordered.map((c) => c.coreArea) };
}

/**
 * Solves the projective map from cell coordinates to image pixels through four point pairs.
 * @param source - Four points in cell coordinates.
 * @param target - The same four points in the image.
 * @returns Nine numbers `h0..h7, 1` (row-major, last fixed at 1), or null when the points are degenerate.
 */
export function solveHomography(source: readonly (readonly [number, number])[], target: readonly Point[]): Float64Array | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = source[i];
    const { x, y } = target[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k < 9; k++) a[row][k] -= factor * a[col][k];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = a[i][8] / a[i][i];
  h[8] = 1;
  return h;
}
