import { type QRConfig, type QRModules, QRStyle } from '@/types';
import { getLogoMetrics, getIsCoveredByLogo, isAlignmentPatternZone } from './utils';
import { renderModules } from './modules';
import { seedRandom } from './prng';
import {
  drawRoundRect,
  drawRoughRect,
  drawPoly,
  drawStar,
  drawCircularModule,
  drawCircuitModule,
} from './canvasHelpers';

interface MazeNode {
  r: number;
  c: number;
}

interface MazeEdge {
  u: MazeNode;
  v: MazeNode;
}

export interface MazeData {
  nodes: MazeNode[];
  edges: MazeEdge[];
  start: MazeNode | null;
  end: MazeNode | null;
  key: MazeNode | null;
  solution: MazeNode[];
}

// Module-private cache for computed mazes; reached only through the functions below.
const mazeCache = new Map<string, MazeData>();

/**
 * Returns the maze previously computed for a cache key (see `getMazeCacheKey`), if any.
 */
export function getCachedMaze(cacheKey: string): MazeData | undefined {
  return mazeCache.get(cacheKey);
}

/**
 * Stores a maze computed elsewhere (for example by the maze Web Worker) under its cache key.
 */
export function storeMaze(cacheKey: string, mazeData: MazeData): void {
  mazeCache.set(cacheKey, mazeData);
}

export function clearMazeCache(): void {
  mazeCache.clear();
}

/**
 * Checks if a grid coordinate lies inside a Finder Pattern or the 2-module safety margin around it.
 * Quiet separator is preserved to prevent scanning issues.
 */
export function isFinderPatternWithMargin(r: number, c: number, size: number): boolean {
  // Finder patterns are 7x7 inside [0, size-1]
  // We exclude an extra margin around finder eyes to guarantee absolute scanner safety.
  if (r >= -2 && r <= 8 && c >= -2 && c <= 8) return true;
  if (r >= -2 && r <= 8 && c >= size - 9 && c <= size + 4) return true;
  if (r >= size - 9 && r <= size + 4 && c >= -2 && c <= 8) return true;
  return false;
}

/**
 * Checks if a grid coordinate is part of a single-module bridge corridor
 * routing directly across the finder pattern safety zone.
 */
export function isBridgeCell(r: number, c: number, size: number): boolean {
  // TL Bridge Corridor: column 3, row 8
  if (c === 3 && r === 8) return true;

  // TR Bridge Corridor: column size - 4, row 8
  if (c === size - 4 && r === 8) return true;

  // BL Bridge Corridor: row size - 4, column 8
  if (r === size - 4 && c === 8) return true;

  return false;
}

/**
 * Disjoint Set Union (DSU) implementation for finding spanning forest.
 */
class DSU {
  parent: Map<string, string>;
  constructor(keys: string[]) {
    this.parent = new Map();
    for (const key of keys) {
      this.parent.set(key, key);
    }
  }

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
    }
  }

  find(x: string): string {
    const px = this.parent.get(x)!;
    if (px === x) return x;
    const root = this.find(px);
    this.parent.set(x, root);
    return root;
  }

  union(x: string, y: string): boolean {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) {
      this.parent.set(rx, ry);
      return true;
    }
    return false;
  }
}

function getModulesFingerprint(modules: QRModules): string {
  const size = modules.size;
  let hash = size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules.get(r, c)) {
        hash = (Math.imul(hash, 31) + r * size + c) | 0;
      }
    }
  }
  return hash.toString(36);
}

export function getMazeCacheKey(config: QRConfig, size: number, modules?: QRModules): string {
  const modKey = modules ? `_${getModulesFingerprint(modules)}` : '';
  return `${config.value}_${config.errorCorrectionLevel}_${size}_${config.logoUrl}_${config.logoSize}_${config.logoPaddingStyle}_${config.logoPadding}_${config.isMazeBridgesEnabled !== false}${modKey}`;
}

/**
 * Generates the maze structure deterministically based on configuration.
 * Restricted strictly to inner matrix dimensions [0, size-1].
 */
export function generateMaze(modules: QRModules, config: QRConfig, size: number): MazeData {
  const cacheKey = getMazeCacheKey(config, size, modules);
  if (mazeCache.has(cacheKey)) {
    return mazeCache.get(cacheKey)!;
  }

  // Calculate Logo cutout zone using existing helpers
  const logoMetrics = getLogoMetrics(config, size, 10); // temporary cell size for metric module counting
  const isCoveredByLogo = getIsCoveredByLogo(config, size, logoMetrics);

  const nodes: MazeNode[] = [];
  const nodeMap = new Map<string, MazeNode>();

  const bridgesEnabled = config.isMazeBridgesEnabled !== false;

  // Extract traversable cells strictly inside inner matrix [0, size - 1]
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const isBridge = !!(bridgesEnabled && isBridgeCell(r, c, size));
      if (isFinderPatternWithMargin(r, c, size)) {
        if (!isBridge) {
          continue;
        }
      }
      if (isAlignmentPatternZone(r, c, size)) {
        continue;
      }
      if (isCoveredByLogo(r, c)) {
        continue;
      }
      if (modules.get(r, c) === true && !isBridge) {
        continue;
      }

      const node: MazeNode = { r, c };
      nodes.push(node);
      nodeMap.set(`${r},${c}`, node);
    }
  }

  // Handle potential maze fragmentation inside the inner matrix by adjusting cell connectivity.
  // Check component connectivity using DSU.
  const initialDsu = new DSU(nodes.map((n) => `${n.r},${n.c}`));
  for (const node of nodes) {
    const rightKey = `${node.r},${node.c + 1}`;
    const downKey = `${node.r + 1},${node.c}`;
    if (nodeMap.has(rightKey)) {
      initialDsu.union(`${node.r},${node.c}`, rightKey);
    }
    if (nodeMap.has(downKey)) {
      initialDsu.union(`${node.r},${node.c}`, downKey);
    }
  }

  // Helper to count unique connected components
  const getComponentCount = () => {
    const roots = new Set<string>();
    for (const node of nodes) {
      roots.add(initialDsu.find(`${node.r},${node.c}`));
    }
    return roots.size;
  };

  // If fragmented (multiple components), adjust connectivity by adding bridge connector cells
  if (nodes.length > 0 && getComponentCount() > 1) {
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    let addedNewCell = true;

    while (addedNewCell && getComponentCount() > 1) {
      addedNewCell = false;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const key = `${r},${c}`;
          if (nodeMap.has(key)) continue;
          if (isCoveredByLogo(r, c)) continue;
          // Avoid finder patterns and quiet zone boundaries (0..7 x 0..7, 0..7 x size-8..size-1, size-8..size-1 x 0..7)
          if (
            (r >= 0 && r <= 7 && c >= 0 && c <= 7) ||
            (r >= 0 && r <= 7 && c >= size - 8 && c <= size - 1) ||
            (r >= size - 8 && r <= size - 1 && c >= 0 && c <= 7)
          ) {
            continue;
          }

          // Check adjacent neighbor components
          const adjacentRoots = new Set<string>();
          const validNeighbors: MazeNode[] = [];
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            const nKey = `${nr},${nc}`;
            if (nodeMap.has(nKey)) {
              adjacentRoots.add(initialDsu.find(nKey));
              validNeighbors.push(nodeMap.get(nKey)!);
            }
          }

          if (adjacentRoots.size > 1) {
            // This cell connects 2+ distinct components! Add it as a connector cell.
            const newNode: MazeNode = { r, c };
            nodes.push(newNode);
            nodeMap.set(key, newNode);
            initialDsu.add(key);

            for (const neighbor of validNeighbors) {
              initialDsu.union(key, `${neighbor.r},${neighbor.c}`);
            }

            addedNewCell = true;
            if (getComponentCount() <= 1) break;
          }
        }
        if (getComponentCount() <= 1) break;
      }
    }
  }

  // Build all potential edges between adjacent nodes
  const edges: MazeEdge[] = [];
  for (const node of nodes) {
    const rightKey = `${node.r},${node.c + 1}`;
    const downKey = `${node.r + 1},${node.c}`;

    if (nodeMap.has(rightKey)) {
      edges.push({ u: node, v: nodeMap.get(rightKey)! });
    }
    if (nodeMap.has(downKey)) {
      edges.push({ u: node, v: nodeMap.get(downKey)! });
    }
  }

  // Deterministic shuffle
  const rng = seedRandom(config.value || 'qrcraftly');
  const shuffledEdges = [...edges];
  for (let i = shuffledEdges.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = shuffledEdges[i];
    shuffledEdges[i] = shuffledEdges[j];
    shuffledEdges[j] = temp;
  }

  // Spanning Forest using Kruskal's
  const dsu = new DSU(nodes.map((n) => `${n.r},${n.c}`));
  const mazeEdges: MazeEdge[] = [];
  for (const edge of shuffledEdges) {
    const uKey = `${edge.u.r},${edge.u.c}`;
    const vKey = `${edge.v.r},${edge.v.c}`;
    if (dsu.union(uKey, vKey)) {
      mazeEdges.push(edge);
    }
  }

  // Find adjacency list for BFS
  const adj = new Map<string, MazeNode[]>();
  for (const node of nodes) {
    adj.set(`${node.r},${node.c}`, []);
  }
  for (const edge of mazeEdges) {
    const uKey = `${edge.u.r},${edge.u.c}`;
    const vKey = `${edge.v.r},${edge.v.c}`;
    adj.get(uKey)!.push(edge.v);
    adj.get(vKey)!.push(edge.u);
  }

  // Pathfinder algorithm with dynamic minimum step threshold
  let startNode: MazeNode | null = null;
  let endNode: MazeNode | null = null;
  let solution: MazeNode[] = [];

  if (nodes.length > 1) {
    // Group nodes by component root in the spanning forest
    const componentMap = new Map<string, MazeNode[]>();
    for (const node of nodes) {
      const root = dsu.find(`${node.r},${node.c}`);
      if (!componentMap.has(root)) {
        componentMap.set(root, []);
      }
      componentMap.get(root)!.push(node);
    }

    let overallBestPath: MazeNode[] = [];

    // For each component, find tree diameter (longest simple path)
    for (const compNodes of componentMap.values()) {
      if (compNodes.length < 2) continue;

      // Helper function: BFS to find furthest node from source and path
      const bfsFurthest = (start: MazeNode) => {
        const queue: MazeNode[] = [start];
        const visited = new Map<string, MazeNode | null>();
        visited.set(`${start.r},${start.c}`, null);

        let furthestNode = start;

        while (queue.length > 0) {
          const curr = queue.shift()!;
          furthestNode = curr;
          const currKey = `${curr.r},${curr.c}`;
          const neighbors = adj.get(currKey)!;

          for (const n of neighbors) {
            const nKey = `${n.r},${n.c}`;
            if (!visited.has(nKey)) {
              visited.set(nKey, curr);
              queue.push(n);
            }
          }
        }

        // Reconstruct path to furthestNode
        const path: MazeNode[] = [];
        let curr: MazeNode | null = furthestNode;
        while (curr) {
          path.push(curr);
          curr = visited.get(`${curr.r},${curr.c}`)!;
        }
        path.reverse();

        return { furthestNode, path };
      };

      // Pick seed node
      const seedNode = compNodes[0];
      // 1. First BFS from seedNode to find one extreme end A
      const { furthestNode: endA } = bfsFurthest(seedNode);
      // 2. Second BFS from endA to find opposite extreme end B and exact path
      const { path: diameterPath } = bfsFurthest(endA);

      if (diameterPath.length > overallBestPath.length) {
        overallBestPath = diameterPath;
      }
    }

    // Dynamic step threshold check:
    // If overallBestPath.length > 1, we set start, end, and solution.
    // If overallBestPath.length >= 10, it satisfies target >= 10 steps.
    // If overallBestPath.length < 10, threshold dynamically adjusts to overallBestPath.length.
    if (overallBestPath.length > 0) {
      startNode = overallBestPath[0];
      endNode = overallBestPath[overallBestPath.length - 1];
      solution = overallBestPath;
    }
  }

  const keyNode: MazeNode | null = solution.length > 0 ? solution[Math.floor(solution.length / 2)] : null;

  const result: MazeData = {
    nodes,
    edges: mazeEdges,
    start: startNode,
    end: endNode,
    key: keyNode,
    solution,
  };

  mazeCache.set(cacheKey, result);
  return result;
}

/**
 * Calculates the style-adaptive default maze path width clearance limit.
 * Standard range: 0.10 to 0.50 (10% to 50% of cell size).
 */
export function getStyleAdaptiveMazePathWidth(style?: QRStyle, configPathWidth?: number): number {
  if (typeof configPathWidth === 'number' && !isNaN(configPathWidth)) {
    return Math.max(0.10, Math.min(0.50, configPathWidth));
  }
  switch (style) {
    case QRStyle.STARBURST:
      return 0.12;
    case QRStyle.HIVE:
      return 0.15;
    case QRStyle.FLUID:
    case QRStyle.CIRCUIT:
      return 0.18;
    case QRStyle.SWISS:
      return 0.20;
    case QRStyle.STANDARD:
    case QRStyle.MODERN:
    case QRStyle.GRUNGE:
    default:
      return 0.25;
  }
}

/**
 * Draws the clearance halo shape for a specific module cell.
 * Applied during canvas halo masking pass to erase overlapping maze paths.
 */
function drawModuleHaloPath(
  ctx: CanvasRenderingContext2D,
  style: QRStyle,
  x: number,
  y: number,
  cx: number,
  cy: number,
  cellSize: number,
  modules: QRModules,
  moduleCount: number,
  r: number,
  c: number,
  isCoveredByLogo: (r: number, c: number) => boolean
): void {
  const haloBuffer = cellSize * 0.08;

  switch (style) {
    case QRStyle.SWISS:
      drawCircularModule(ctx, cx, cy, cellSize, 1.15);
      break;

    case QRStyle.FLUID:
      drawCircularModule(ctx, cx, cy, cellSize, 1.22);
      break;

    case QRStyle.HIVE: {
      const rHiveHalo = cellSize / 1.40;
      drawPoly(ctx, cx, cy, rHiveHalo, 6, 0, false, true);
      break;
    }

    case QRStyle.STARBURST: {
      const outerRHalo = cellSize / 1.35;
      const innerRHalo = cellSize / 2.0;
      drawStar(ctx, cx, cy, outerRHalo, innerRHalo, 5, false, true);
      break;
    }

    case QRStyle.CIRCUIT: {
      const hasTop = r > 0 && modules.get(r - 1, c) && !isCoveredByLogo(r - 1, c);
      const hasBottom = r < moduleCount - 1 && modules.get(r + 1, c) && !isCoveredByLogo(r + 1, c);
      const hasLeft = c > 0 && modules.get(r, c - 1) && !isCoveredByLogo(r, c - 1);
      const hasRight = c < moduleCount - 1 && modules.get(r, c + 1) && !isCoveredByLogo(r, c + 1);

      drawCircuitModule(ctx, x, y, cx, cy, cellSize, hasTop, hasBottom, hasLeft, hasRight);
      drawRoundRect(ctx, x - haloBuffer, y - haloBuffer, cellSize + 2 * haloBuffer, cellSize + 2 * haloBuffer, cellSize * 0.35);
      break;
    }

    case QRStyle.MODERN: {
      const rModern = cellSize * 0.3;
      drawRoundRect(ctx, x - haloBuffer, y - haloBuffer, cellSize + 2 * haloBuffer, cellSize + 2 * haloBuffer, rModern + haloBuffer);
      break;
    }

    case QRStyle.GRUNGE: {
      drawRoughRect(ctx, x - haloBuffer, y - haloBuffer, cellSize + 2 * haloBuffer, cellSize + 2 * haloBuffer, true);
      break;
    }

    case QRStyle.STANDARD:
    default: {
      ctx.rect(x - haloBuffer, y - haloBuffer, cellSize + 2 * haloBuffer, cellSize + 2 * haloBuffer);
      break;
    }
  }
}

/**
 * Applies a visual canvas halo mask to actively clear any maze paths overlapping styled modules,
 * and re-renders active modules in foreground color.
 * Preserves finder pattern eyes, quiet zones, and logo cutout bounds.
 */
function applyMazeHaloMask(
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  drawX: number,
  drawY: number,
  cellSize: number,
  size: number
): void {
  const logoMetrics = getLogoMetrics(config, size, cellSize);
  const isCoveredByLogo = getIsCoveredByLogo(config, size, logoMetrics);
  const bridgesEnabled = config.isMazeBridgesEnabled !== false;

  ctx.save();

  // 1. Clear overlapping maze path pixels over module halo areas
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';

  ctx.beginPath();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules.get(r, c)) continue;
      if (isCoveredByLogo(r, c)) continue;
      if (bridgesEnabled && isBridgeCell(r, c, size)) continue;

      const x = drawX + c * cellSize;
      const y = drawY + r * cellSize;
      const cx = x + cellSize / 2;
      const cy = y + cellSize / 2;

      drawModuleHaloPath(ctx, config.style, x, y, cx, cy, cellSize, modules, size, r, c, isCoveredByLogo);
    }
  }

  ctx.fill();

  // 2. Restore normal composite operation and re-render active modules cleanly on top
  ctx.globalCompositeOperation = 'source-over';
  renderModules(ctx, modules, config, drawX, drawY, cellSize, size, logoMetrics);

  ctx.restore();
}

/**
 * Renders the maze overlay directly on the canvas context.
 */
export function renderMaze(
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  drawX: number,
  drawY: number,
  cellSize: number,
  size: number,
  mazeData?: MazeData | null
) {
  if (!config.isMazeEnabled) return;

  const cacheKey = getMazeCacheKey(config, size, modules);
  const maze = mazeData || mazeCache.get(cacheKey);

  // Maze generation is off-thread (or idle-time) work owned by the caller; draw only what is ready.
  if (!maze) return;

  const effectivePathWidth = getStyleAdaptiveMazePathWidth(config.style, config.mazePathWidth);
  const pathWidth = cellSize * Math.max(0.10, Math.min(0.50, effectivePathWidth));

  ctx.save();

  // 1. Draw Maze Paths (all corridors in the forest)
  ctx.beginPath();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = config.mazeColor || '#3b82f6';
  ctx.lineWidth = pathWidth;

  for (const edge of maze.edges) {
    const ux = drawX + (edge.u.c + 0.5) * cellSize;
    const uy = drawY + (edge.u.r + 0.5) * cellSize;
    const vx = drawX + (edge.v.c + 0.5) * cellSize;
    const vy = drawY + (edge.v.r + 0.5) * cellSize;

    ctx.moveTo(ux, uy);
    ctx.lineTo(vx, vy);
  }
  ctx.stroke();

  // 2. Draw Solution Path (if enabled or default highlight)
  if (config.showMazeSolution && maze.solution.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444'; // Red for solved path
    ctx.lineWidth = pathWidth * 1.3; // slightly thicker
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = maze.solution[0];
    ctx.moveTo(drawX + (first.c + 0.5) * cellSize, drawY + (first.r + 0.5) * cellSize);

    for (let i = 1; i < maze.solution.length; i++) {
      const p = maze.solution[i];
      ctx.lineTo(drawX + (p.c + 0.5) * cellSize, drawY + (p.r + 0.5) * cellSize);
    }
    ctx.stroke();
  }

  // 3. Draw Start, Key, and End Markers
  if (maze.start) {
    const sx = drawX + (maze.start.c + 0.5) * cellSize;
    const sy = drawY + (maze.start.r + 0.5) * cellSize;

    // Green start dot
    ctx.beginPath();
    ctx.arc(sx, sy, cellSize * 0.35, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.3)'; // translucent green outer ring
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, cellSize * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = '#10b981'; // solid green inner dot
    ctx.fill();
  }

  if (maze.key) {
    const kx = drawX + (maze.key.c + 0.5) * cellSize;
    const ky = drawY + (maze.key.r + 0.5) * cellSize;

    // Gold key checkpoint dot
    ctx.beginPath();
    ctx.arc(kx, ky, cellSize * 0.35, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(234, 179, 8, 0.3)'; // translucent gold outer ring
    ctx.fill();

    ctx.beginPath();
    ctx.arc(kx, ky, cellSize * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = '#eab308'; // solid gold inner dot
    ctx.fill();
  }

  if (maze.end) {
    const ex = drawX + (maze.end.c + 0.5) * cellSize;
    const ey = drawY + (maze.end.r + 0.5) * cellSize;

    // Orange/Red end dot
    ctx.beginPath();
    ctx.arc(ex, ey, cellSize * 0.35, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'; // translucent red outer ring
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex, ey, cellSize * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = '#ef4444'; // solid red inner dot
    ctx.fill();
  }

  // 4. Apply Canvas Halo Masking to clear any maze paths overlapping styled modules
  applyMazeHaloMask(ctx, modules, config, drawX, drawY, cellSize, size);

  ctx.restore();
}
