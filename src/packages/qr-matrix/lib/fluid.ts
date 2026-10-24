/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import type { RenderSurface } from './surface';

interface Point {
  x: number;
  y: number;
}

export type Contour = Point[];

interface Segment {
  p1: Point;
  p2: Point;
}

interface FluidCurve {
  ax: number;
  ay: number;
  cpx: number;
  cpy: number;
  bx: number;
  by: number;
}

interface FluidContourPath {
  startX: number;
  startY: number;
  curves: FluidCurve[];
}

// Micro-cache for traced fluid paths to sustain 60 FPS animations and live preview scrubbing
const fluidPathCache = new Map<string, FluidContourPath[]>();
const MAX_CACHE_ENTRIES = 50;

/**
 * Clears the fluid contour cache.
 */
export function clearFluidCache(): void {
  fluidPathCache.clear();
}

/**
 * Determines if a module coordinate lies inside any of the three 7x7 Finder Patterns.
 *
 * @param r Row coordinate in QR grid.
 * @param c Column coordinate in QR grid.
 * @param moduleCount Total number of modules along one dimension.
 * @returns True if inside a finder pattern, false otherwise.
 */
export function isFinderPattern(r: number, c: number, moduleCount: number): boolean {
  if (r < 7 && c < 7) return true; // Top-Left
  if (r < 7 && c >= moduleCount - 7) return true; // Top-Right
  if (r >= moduleCount - 7 && c < 7) return true; // Bottom-Left
  return false;
}

/**
 * Determines if a module coordinate lies within the 1-module quiet separator zone surrounding the finder patterns.
 *
 * @param r Row coordinate in QR grid.
 * @param c Column coordinate in QR grid.
 * @param moduleCount Total number of modules along one dimension.
 * @returns True if inside the 1-module separator zone, false otherwise.
 */
export function isFinderSeparatorZone(r: number, c: number, moduleCount: number): boolean {
  // Top-Left Separator (row 7 cols 0..7 or col 7 rows 0..7)
  if ((r === 7 && c <= 7) || (c === 7 && r <= 7)) return true;

  // Top-Right Separator (row 7 cols N-8..N-1 or col N-8 rows 0..7)
  if ((r === 7 && c >= moduleCount - 8) || (c === moduleCount - 8 && r <= 7)) return true;

  // Bottom-Left Separator (row N-8 cols 0..7 or col 7 rows N-8..N-1)
  if ((r === moduleCount - 8 && c <= 7) || (c === 7 && r >= moduleCount - 8)) return true;

  return false;
}

/**
 * Checks if a cell is protected from fluid bleeding/bridging (finder eye or separator buffer).
 */
export function isFinderProtected(r: number, c: number, moduleCount: number): boolean {
  if (r < 8 && c < 8) return true;
  if (r < 8 && c >= moduleCount - 8) return true;
  if (r >= moduleCount - 8 && c < 8) return true;
  return false;
}

/**
 * Generates a deterministic cache key for the active module grid and sizing parameters.
 */
function getCacheKey(
  activeGrid: Uint8Array,
  moduleCount: number,
  drawX: number,
  drawY: number,
  cellSize: number
): string {
  let hash = 2166136261 >>> 0;
  const len = activeGrid.length;
  const wordCount = Math.floor(len / 4);
  const u32 = new Uint32Array(activeGrid.buffer, activeGrid.byteOffset, wordCount);
  for (let i = 0; i < wordCount; i++) {
    hash ^= u32[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  for (let i = wordCount * 4; i < len; i++) {
    hash ^= activeGrid[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${hash}_${moduleCount}_${drawX.toFixed(1)}_${drawY.toFixed(1)}_${cellSize.toFixed(1)}`;
}

/**
 * Extracts unified perimeter contour loops for active modules, incorporating calibrated diagonal neck bridges.
 *
 * @param activeGrid 1D binary array of length moduleCount * moduleCount (1 = active, 0 = inactive).
 * @param moduleCount Module dimension of the QR code.
 * @param drawX Physical X offset for canvas drawing.
 * @param drawY Physical Y offset for canvas drawing.
 * @param cellSize Physical pixel width/height of a single QR module.
 * @returns Array of closed polygon contours in physical pixel coordinates.
 */
export function extractFluidContours(
  activeGrid: Uint8Array,
  moduleCount: number,
  drawX: number,
  drawY: number,
  cellSize: number
): Contour[] {
  const getActive = (r: number, c: number): boolean => {
    if (r < 0 || r >= moduleCount || c < 0 || c >= moduleCount) return false;
    return activeGrid[r * moduleCount + c] === 1;
  };

  const toPx = (c: number, r: number): Point => ({
    x: drawX + c * cellSize,
    y: drawY + r * cellSize,
  });

  // 1. Detect diagonal bridges across 2x2 intersections
  // Bridge half-waist offset in module units (waist width = 2 * w * cellSize ~ 0.28 cellSize)
  const w = 0.14;
  interface DiagonalBridge {
    type: 'TL_BR' | 'TR_BL';
  }
  const diagonalBridges = new Map<string, DiagonalBridge>();

  for (let r = 1; r < moduleCount; r++) {
    for (let c = 1; c < moduleCount; c++) {
      const tl = getActive(r - 1, c - 1);
      const tr = getActive(r - 1, c);
      const bl = getActive(r, c - 1);
      const br = getActive(r, c);

      // Skip bridging if crossing into finder protected zone
      if (
        isFinderProtected(r - 1, c - 1, moduleCount) ||
        isFinderProtected(r - 1, c, moduleCount) ||
        isFinderProtected(r, c - 1, moduleCount) ||
        isFinderProtected(r, c, moduleCount)
      ) {
        continue;
      }

      if (tl && br && !tr && !bl) {
        diagonalBridges.set(`${c},${r}`, { type: 'TL_BR' });
      } else if (tr && bl && !tl && !br) {
        diagonalBridges.set(`${c},${r}`, { type: 'TR_BL' });
      }
    }
  }

  // 2. Generate directed boundary segments
  // Each segment is directed clockwise around the active cell.
  const segments: Segment[] = [];

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (!getActive(r, c)) continue;

      // Top Edge: from (c, r) to (c + 1, r)
      if (!getActive(r - 1, c)) {
        let xStart = c;
        let xEnd = c + 1;

        // If at (c, r) this is the BR cell of a TL_BR bridge, Top edge starts at c + 0.5
        const bStart = diagonalBridges.get(`${c},${r}`);
        if (bStart?.type === 'TL_BR') {
          xStart = c + 0.5;
        }

        // If at (c + 1, r) this is the BL cell of a TR_BL bridge, Top edge ends at c + 1 - 0.5
        const bEnd = diagonalBridges.get(`${c + 1},${r}`);
        if (bEnd?.type === 'TR_BL') {
          xEnd = c + 1 - 0.5;
        }

        segments.push({ p1: toPx(xStart, r), p2: toPx(xEnd, r) });
      }

      // Right Edge: from (c + 1, r) to (c + 1, r + 1)
      if (!getActive(r, c + 1)) {
        let yStart = r;
        let yEnd = r + 1;

        // If at (c + 1, r) this is the BL cell of a TR_BL bridge, Right edge starts at r + 0.5
        const bStart = diagonalBridges.get(`${c + 1},${r}`);
        if (bStart?.type === 'TR_BL') {
          yStart = r + 0.5;
        }

        // If at (c + 1, r + 1) this is the TL cell of a TL_BR bridge, Right edge ends at r + 1 - 0.5
        const bEnd = diagonalBridges.get(`${c + 1},${r + 1}`);
        if (bEnd?.type === 'TL_BR') {
          yEnd = r + 1 - 0.5;
        }

        segments.push({ p1: toPx(c + 1, yStart), p2: toPx(c + 1, yEnd) });
      }

      // Bottom Edge: from (c + 1, r + 1) to (c, r + 1)
      if (!getActive(r + 1, c)) {
        let xStart = c + 1;
        let xEnd = c;

        // If at (c + 1, r + 1) this is the TL cell of a TL_BR bridge, Bottom edge starts at c + 0.5
        const bStart = diagonalBridges.get(`${c + 1},${r + 1}`);
        if (bStart?.type === 'TL_BR') {
          xStart = c + 0.5;
        }

        // If at (c, r + 1) this is the TR cell of a TR_BL bridge, Bottom edge ends at c + 0.5
        const bEnd = diagonalBridges.get(`${c},${r + 1}`);
        if (bEnd?.type === 'TR_BL') {
          xEnd = c + 0.5;
        }

        segments.push({ p1: toPx(xStart, r + 1), p2: toPx(xEnd, r + 1) });
      }

      // Left Edge: from (c, r + 1) to (c, r)
      if (!getActive(r, c - 1)) {
        let yStart = r + 1;
        let yEnd = r;

        // If at (c, r + 1) this is the TR cell of a TR_BL bridge, Left edge starts at r + 1 - 0.5
        const bStart = diagonalBridges.get(`${c},${r + 1}`);
        if (bStart?.type === 'TR_BL') {
          yStart = r + 1 - 0.5;
        }

        // If at (c, r) this is the BR cell of a TL_BR bridge, Left edge ends at r + 0.5
        const bEnd = diagonalBridges.get(`${c},${r}`);
        if (bEnd?.type === 'TL_BR') {
          yEnd = r + 0.5;
        }

        segments.push({ p1: toPx(c, yStart), p2: toPx(c, yEnd) });
      }
    }
  }

  // 3. Add diagonal bridge neck crossover segments
  for (const [key, bridge] of diagonalBridges.entries()) {
    const [cStr, rStr] = key.split(',');
    const c = Number(cStr);
    const r = Number(rStr);

    if (bridge.type === 'TL_BR') {
      // Crossover 1 (TR side): Right edge of TL ends at (c, r - 0.5), connects to Top edge of BR starting at (c + 0.5, r)
      segments.push({ p1: toPx(c, r - 0.5), p2: toPx(c + w, r - w) });
      segments.push({ p1: toPx(c + w, r - w), p2: toPx(c + 0.5, r) });

      // Crossover 2 (BL side): Left edge of BR ends at (c, r + 0.5), connects to Bottom edge of TL starting at (c - 0.5, r)
      segments.push({ p1: toPx(c, r + 0.5), p2: toPx(c - w, r + w) });
      segments.push({ p1: toPx(c - w, r + w), p2: toPx(c - 0.5, r) });
    } else if (bridge.type === 'TR_BL') {
      // Crossover 1 (BR side): Bottom edge of TR ends at (c + 0.5, r), connects to Right edge of BL starting at (c, r + 0.5)
      segments.push({ p1: toPx(c + 0.5, r), p2: toPx(c + w, r + w) });
      segments.push({ p1: toPx(c + w, r + w), p2: toPx(c, r + 0.5) });

      // Crossover 2 (TL side): Top edge of BL ends at (c - 0.5, r), connects to Left edge of TR starting at (c, r - 0.5)
      segments.push({ p1: toPx(c - 0.5, r), p2: toPx(c - w, r - w) });
      segments.push({ p1: toPx(c - w, r - w), p2: toPx(c, r - 0.5) });
    }
  }

  // 4. Assemble segments into closed loops
  if (segments.length === 0) return [];

  const ptKey = (p: Point): string => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const adjacency = new Map<string, Array<{ segment: Segment; used: boolean }>>();

  for (const seg of segments) {
    const k = ptKey(seg.p1);
    if (!adjacency.has(k)) {
      adjacency.set(k, []);
    }
    adjacency.get(k)!.push({ segment: seg, used: false });
  }

  const contours: Contour[] = [];

  for (const segList of adjacency.values()) {
    for (const item of segList) {
      if (item.used) continue;

      const loop: Point[] = [];
      let currentItem: { segment: Segment; used: boolean } | null = item;
      let lastSeg: Segment | null = null;

      while (currentItem && !currentItem.used) {
        currentItem.used = true;
        lastSeg = currentItem.segment;
        loop.push(currentItem.segment.p1);

        const nextKey = ptKey(currentItem.segment.p2);
        const candidates = adjacency.get(nextKey);
        currentItem = null;

        if (candidates) {
          let bestCand: { segment: Segment; used: boolean } | null = null;
          let bestAngle = Infinity;

          const inDx = lastSeg.p2.x - lastSeg.p1.x;
          const inDy = lastSeg.p2.y - lastSeg.p1.y;
          const inAngle = Math.atan2(inDy, inDx);

          for (const cand of candidates) {
            if (cand.used) continue;
            if (candidates.length === 1) {
              bestCand = cand;
              break;
            }
            const outDx = cand.segment.p2.x - cand.segment.p1.x;
            const outDy = cand.segment.p2.y - cand.segment.p1.y;
            const outAngle = Math.atan2(outDy, outDx);

            const diff = outAngle - inAngle;
            let turnAngle = diff % (2 * Math.PI);
            if (turnAngle <= 0) turnAngle += 2 * Math.PI;

            if (turnAngle < bestAngle) {
              bestAngle = turnAngle;
              bestCand = cand;
            }
          }
          currentItem = bestCand;
        }
      }

      // Assert loop closure: the last segment's p2 must cycle back to loop[0]
      const isClosed =
        lastSeg !== null && loop.length >= 3 && ptKey(lastSeg.p2) === ptKey(loop[0]);

      if (isClosed) {
        // Simplify consecutive collinear points along straight lines
        const simplified: Point[] = [];
        const n = loop.length;
        for (let i = 0; i < n; i++) {
          const prev = loop[(i - 1 + n) % n];
          const curr = loop[i];
          const next = loop[(i + 1) % n];

          const v1x = curr.x - prev.x;
          const v1y = curr.y - prev.y;
          const v2x = next.x - curr.x;
          const v2y = next.y - curr.y;

          // Cross product of direction vectors
          const cross = v1x * v2y - v1y * v2x;
          const dot = v1x * v2x + v1y * v2y;

          // If collinear and moving in the same direction, skip intermediate point
          if (Math.abs(cross) < 1e-4 && dot > 0) {
            continue;
          }
          simplified.push(curr);
        }

        if (simplified.length >= 3) {
          contours.push(simplified);
        }
      }
    }
  }

  return contours;
}

/**
 * Computes signed shoelace area of a 2D polygon loop.
 */
function getSignedPolygonArea(loop: Contour): number {
  let area = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p1 = loop[i];
    const p2 = loop[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area / 2;
}

/**
 * Pre-computes smooth Bezier curve parameters for all contours.
 */
function buildFluidContourPaths(contours: Contour[], cellSize: number): FluidContourPath[] {
  const outerR = cellSize * 0.5; // Pill corner radius (exterior convex)
  const innerR = cellSize * 0.25; // Meniscus corner radius (interior concave)
  const paths: FluidContourPath[] = [];

  for (const loop of contours) {
    const n = loop.length;
    if (n < 3) continue;

    const isClockwise = getSignedPolygonArea(loop) > 0;

    // Precalculate corner points A (curve start) and B (curve end) for each vertex
    const cornerA: Point[] = new Array(n);
    const cornerB: Point[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const prev = loop[(i - 1 + n) % n];
      const curr = loop[i];
      const next = loop[(i + 1) % n];

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const len1 = Math.hypot(v1x, v1y);

      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const len2 = Math.hypot(v2x, v2y);

      if (len1 < 1e-5 || len2 < 1e-5) {
        cornerA[i] = curr;
        cornerB[i] = curr;
        continue;
      }

      const d1x = v1x / len1;
      const d1y = v1y / len1;
      const d2x = v2x / len2;
      const d2y = v2y / len2;

      // 2D cross product: positive = right turn, negative = left turn
      const cross = d1x * d2y - d1y * d2x;

      let targetR: number;
      if (isClockwise) {
        // Clockwise: right turns are exterior convex, left turns are interior concave
        targetR = cross > 0.05 ? outerR : cross < -0.05 ? innerR : 0;
      } else {
        // Counter-clockwise (hole): left turns are exterior to hole, right turns are interior
        targetR = cross < -0.05 ? outerR : cross > 0.05 ? innerR : 0;
      }

      const safeR = Math.min(targetR, len1 / 2, len2 / 2);

      if (safeR < 0.5) {
        cornerA[i] = curr;
        cornerB[i] = curr;
      } else {
        cornerA[i] = {
          x: curr.x - d1x * safeR,
          y: curr.y - d1y * safeR,
        };
        cornerB[i] = {
          x: curr.x + d2x * safeR,
          y: curr.y + d2y * safeR,
        };
      }
    }

    const curves: FluidCurve[] = [];
    for (let i = 1; i < n; i++) {
      curves.push({
        ax: cornerA[i].x,
        ay: cornerA[i].y,
        cpx: loop[i].x,
        cpy: loop[i].y,
        bx: cornerB[i].x,
        by: cornerB[i].y,
      });
    }
    curves.push({
      ax: cornerA[0].x,
      ay: cornerA[0].y,
      cpx: loop[0].x,
      cpy: loop[0].y,
      bx: cornerB[0].x,
      by: cornerB[0].y,
    });

    paths.push({
      startX: cornerB[0].x,
      startY: cornerB[0].y,
      curves,
    });
  }

  return paths;
}

/**
 * Executes precomputed fluid paths directly onto the canvas context.
 */
function drawFluidPaths(
  ctx: RenderSurface,
  paths: FluidContourPath[]
): void {
  for (let p = 0; p < paths.length; p++) {
    const path = paths[p];
    ctx.moveTo(path.startX, path.startY);
    const curves = path.curves;
    for (let i = 0; i < curves.length; i++) {
      const c = curves[i];
      ctx.lineTo(c.ax, c.ay);
      if (c.ax !== c.bx || c.ay !== c.by) {
        ctx.quadraticCurveTo(c.cpx, c.cpy, c.bx, c.by);
      }
    }
    ctx.closePath();
  }
}

/**
 * Draws smooth Bezier-filleted fluid paths for each contour onto the 2D canvas context.
 *
 * @param ctx Target CanvasRenderingContext2D (or SvgContext).
 * @param contours Array of closed polygon loops.
 * @param cellSize Physical size of a single QR module.
 */
export function drawFluidContours(
  ctx: RenderSurface,
  contours: Contour[],
  cellSize: number
): void {
  const paths = buildFluidContourPaths(contours, cellSize);
  drawFluidPaths(ctx, paths);
}

/**
 * Main entrypoint to render fluid connected QR modules onto a canvas context.
 *
 * @param ctx 2D Canvas context or SvgContext.
 * @param activeGrid 1D binary array of active modules for the current color pass.
 * @param drawX Left drawing offset.
 * @param drawY Top drawing offset.
 * @param cellSize Physical size of one module.
 * @param moduleCount Module count along one dimension.
 */
export function renderFluidModules(
  ctx: RenderSurface,
  activeGrid: Uint8Array,
  drawX: number,
  drawY: number,
  cellSize: number,
  moduleCount: number
): void {
  const cacheKey = getCacheKey(activeGrid, moduleCount, drawX, drawY, cellSize);
  let paths = fluidPathCache.get(cacheKey);

  if (!paths) {
    const contours = extractFluidContours(activeGrid, moduleCount, drawX, drawY, cellSize);
    paths = buildFluidContourPaths(contours, cellSize);
    if (fluidPathCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = fluidPathCache.keys().next().value;
      if (oldestKey) fluidPathCache.delete(oldestKey);
    }
    fluidPathCache.set(cacheKey, paths);
  }

  drawFluidPaths(ctx, paths);
}

