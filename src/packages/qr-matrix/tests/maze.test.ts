import { describe, it, expect, vi } from 'vitest';
import {
  generateMaze,
  renderMaze,
  isFinderPatternWithMargin,
  isBridgeCell,
  getStyleAdaptiveMazePathWidth,
  getMazeCacheKey,
  getCachedMaze,
  storeMaze,
  clearMazeCache,
} from '../maze';
import { QRStyle, QRType, QRErrorCorrectionLevel } from '@/packages/core/types';

describe('isFinderPatternWithMargin', () => {
  it('identifies top-left finder eye zone correctly', () => {
    expect(isFinderPatternWithMargin(0, 0, 21)).toBe(true);
    expect(isFinderPatternWithMargin(3, 3, 21)).toBe(true);
    expect(isFinderPatternWithMargin(7, 7, 21)).toBe(true);
    expect(isFinderPatternWithMargin(8, 8, 21)).toBe(true);
    expect(isFinderPatternWithMargin(-2, -2, 21)).toBe(true);
  });

  it('identifies top-right finder eye zone correctly', () => {
    const size = 21;
    expect(isFinderPatternWithMargin(0, size - 1, size)).toBe(true);
    expect(isFinderPatternWithMargin(0, size - 7, size)).toBe(true);
    expect(isFinderPatternWithMargin(8, size - 9, size)).toBe(true);
    expect(isFinderPatternWithMargin(-2, size + 4, size)).toBe(true);
  });

  it('identifies bottom-left finder eye zone correctly', () => {
    const size = 21;
    expect(isFinderPatternWithMargin(size - 1, 0, size)).toBe(true);
    expect(isFinderPatternWithMargin(size - 7, 0, size)).toBe(true);
    expect(isFinderPatternWithMargin(size - 9, 8, size)).toBe(true);
    expect(isFinderPatternWithMargin(size + 4, -2, size)).toBe(true);
  });

  it('returns false for safe zones', () => {
    const size = 21;
    // (10, 10) is typically a safe middle zone
    expect(isFinderPatternWithMargin(10, 10, size)).toBe(false);
  });
});

describe('generateMaze & renderMaze', () => {
  const createMockModules = (size: number, darkMap: Record<string, boolean> = {}) => {
    return {
      size,
      get: (r: number, c: number) => !!darkMap[`${r},${c}`],
    };
  };

  const baseConfig = {
    value: 'https://qrcraftly.com',
    type: QRType.URL,
    fgColor: '#000000',
    bgColor: '#ffffff',
    style: QRStyle.STANDARD,
    logoUrl: null,
    logoSize: 0.2,
    logoPaddingStyle: 'none' as const,
    logoPadding: 0,
    logoBackgroundColor: '#ffffff',
    eyeColor: '#000000',
    errorCorrectionLevel: QRErrorCorrectionLevel.H,
    isBorderEnabled: false,
    borderSize: 0.05,
    borderColor: '#000000',
    borderStyle: 'solid' as const,
    borderText: '',
    borderTextPosition: 'bottom-center' as const,
    borderTextColor: '#ffffff',
    borderLogoUrl: null,
    borderLogoPosition: 'bottom-center' as const,
    isMazeEnabled: true,
    mazeColor: '#3b82f6',
    showMazeSolution: true,
  } as any;

  const createMockCtx = () => {
    return {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
  };

  it('generates deterministic maze data', () => {
    const size = 21;
    const modules = createMockModules(size);
    const mazeData = generateMaze(modules, baseConfig, size);

    expect(mazeData.nodes.length).toBeGreaterThan(0);
    expect(mazeData.edges.length).toBeGreaterThan(0);
    expect(mazeData.start).not.toBeNull();
    expect(mazeData.end).not.toBeNull();
    expect(mazeData.key).not.toBeNull();
    expect(mazeData.solution.length).toBeGreaterThan(1);
    expect(mazeData.key).toEqual(mazeData.solution[Math.floor(mazeData.solution.length / 2)]);

    // Verify coordinates are strictly within inner matrix range [0, size - 1]
    for (const node of mazeData.nodes) {
      expect(node.r).toBeGreaterThanOrEqual(0);
      expect(node.r).toBeLessThan(size);
      expect(node.c).toBeGreaterThanOrEqual(0);
      expect(node.c).toBeLessThan(size);
    }
  });

  it('excludes dark modules from maze generation', () => {
    const size = 21;
    // Set cell (10, 10) as a dark module
    const modules = createMockModules(size, { '10,10': true });
    const mazeData = generateMaze(modules, baseConfig, size);

    const hasDarkNode = mazeData.nodes.some(n => n.r === 10 && n.c === 10);
    expect(hasDarkNode).toBe(false);
  });

  it('excludes cells covered by logo from maze generation', () => {
    const size = 21;
    const modules = createMockModules(size);
    const configWithLogo = {
      ...baseConfig,
      logoUrl: 'https://qrcraftly.com/logo.png',
      logoSize: 0.3,
    };
    const mazeData = generateMaze(modules, configWithLogo, size);
    // Since logo covers the center (e.g. 10,10), there should be no node at (10,10)
    const hasCenterNode = mazeData.nodes.some(n => n.r === 10 && n.c === 10);
    expect(hasCenterNode).toBe(false);
  });

  it('excludes any 7x7 alignment pattern zone from maze nodes and edges (V2 and larger)', () => {
    // Version 2 has size 25, alignment pattern center at (18, 18)
    const size = 25;
    const modules = createMockModules(size);
    const mazeData = generateMaze(modules, baseConfig, size);

    const centerR = 18;
    const centerC = 18;

    for (const node of mazeData.nodes) {
      const inZone = Math.abs(node.r - centerR) <= 3 && Math.abs(node.c - centerC) <= 3;
      expect(inZone).toBe(false);
    }

    for (const edge of mazeData.edges) {
      const uInZone = Math.abs(edge.u.r - centerR) <= 3 && Math.abs(edge.u.c - centerC) <= 3;
      const vInZone = Math.abs(edge.v.r - centerR) <= 3 && Math.abs(edge.v.c - centerC) <= 3;
      expect(uInZone).toBe(false);
      expect(vInZone).toBe(false);
    }
  });

  it('renders nothing if isMazeEnabled is false', () => {
    const ctx = createMockCtx();
    const size = 21;
    const modules = createMockModules(size);
    const disabledConfig = { ...baseConfig, isMazeEnabled: false };

    renderMaze(ctx, modules, disabledConfig, 0, 0, 10, size);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('draws nothing until a maze has been computed for the modules', () => {
    clearMazeCache();
    const ctx = createMockCtx();
    const size = 21;
    const modules = createMockModules(size);

    renderMaze(ctx, modules, { ...baseConfig, value: 'not-yet-computed' }, 0, 0, 10, size);

    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('draws a maze stored under its cache key without regenerating it', () => {
    clearMazeCache();
    const ctx = createMockCtx();
    const size = 21;
    const modules = createMockModules(size);
    const config = { ...baseConfig, value: 'stored-maze' };
    const computed = generateMaze(modules, config, size);
    clearMazeCache();

    const key = getMazeCacheKey(config, size, modules);
    storeMaze(key, computed);
    expect(getCachedMaze(key)).toBe(computed);

    renderMaze(ctx, modules, config, 0, 0, 10, size);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('renders the maze and start/end markers when isMazeEnabled is true', () => {
    const ctx = createMockCtx();
    const size = 21;
    const modules = createMockModules(size);

    renderMaze(ctx, modules, baseConfig, 0, 0, 10, size, generateMaze(modules, baseConfig, size));

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled(); // for start/end dot
    expect(ctx.restore).toHaveBeenCalled();
  });

  describe('Scannability-Audited Bridge Channels', () => {
    it('generates bridges across the safety zones when isMazeBridgesEnabled is true', () => {
      const size = 21;
      const modules = createMockModules(size);
      const configWithBridges = { ...baseConfig, isMazeBridgesEnabled: true };
      const mazeData = generateMaze(modules, configWithBridges, size);

      // Verify that bridge cells are present at row 8 (TL/TR) and col 8 (BL) as nodes in the maze
      const tlBridgeNodes = mazeData.nodes.filter(n => n.c === 3 && n.r === 8);
      const trBridgeNodes = mazeData.nodes.filter(n => n.c === size - 4 && n.r === 8);
      const blBridgeNodes = mazeData.nodes.filter(n => n.r === size - 4 && n.c === 8);

      expect(tlBridgeNodes.length).toBe(1);
      expect(trBridgeNodes.length).toBe(1);
      expect(blBridgeNodes.length).toBe(1);

      // Verify ZERO nodes on row 7 or column 7 in finder pattern quiet zones
      const quietZoneRow7orCol7Nodes = mazeData.nodes.filter(n => {
        const isTLQuietZone = n.r <= 7 && n.c <= 7 && (n.r === 7 || n.c === 7);
        const isTRQuietZone = n.r <= 7 && n.c >= size - 8 && (n.r === 7 || n.c === size - 8);
        const isBLQuietZone = n.r >= size - 8 && n.c <= 7 && (n.r === size - 8 || n.c === 7);
        return isTLQuietZone || isTRQuietZone || isBLQuietZone;
      });
      expect(quietZoneRow7orCol7Nodes.length).toBe(0);
    });

    it('does not generate bridges when isMazeBridgesEnabled is false', () => {
      const size = 21;
      const modules = createMockModules(size);
      const configNoBridges = { ...baseConfig, isMazeBridgesEnabled: false };
      const mazeData = generateMaze(modules, configNoBridges, size);

      // Verify that bridge cells at row 8 / col 8 in safety zone are NOT present
      const tlBridgeNodes = mazeData.nodes.filter(n => n.c === 3 && n.r === 8);
      const trBridgeNodes = mazeData.nodes.filter(n => n.c === size - 4 && n.r === 8);
      const blBridgeNodes = mazeData.nodes.filter(n => n.r === size - 4 && n.c === 8);

      expect(tlBridgeNodes.length).toBe(0);
      expect(trBridgeNodes.length).toBe(0);
      expect(blBridgeNodes.length).toBe(0);
    });

    it('excludes logo cutout area from maze nodes', () => {
      const size = 21;
      const modules = createMockModules(size);
      const logoConfig = {
        ...baseConfig,
        logoUrl: 'https://example.com/logo.png',
        logoSize: 0.3,
        logoPaddingStyle: 'circle',
        logoPadding: 2,
      };
      const mazeData = generateMaze(modules, logoConfig, size);
      // Since logo is centered, nodes near the center should be excluded
      const centerNode = mazeData.nodes.some(n => n.r === 10 && n.c === 10);
      expect(centerNode).toBe(false);
    });

    it('enables bridges by default if isMazeBridgesEnabled is undefined', () => {
      const size = 21;
      const modules = createMockModules(size);
      const { isMazeBridgesEnabled, ...configWithoutBridgesProp } = baseConfig;
      const mazeData = generateMaze(modules, configWithoutBridgesProp, size);

      // Verify that bridge cells are present as nodes in the maze at row 8
      const tlBridgeNodes = mazeData.nodes.filter(n => n.c === 3 && n.r === 8);
      expect(tlBridgeNodes.length).toBe(1);
    });

    it('does not render solution path if showMazeSolution is false', () => {
      const ctx = createMockCtx();
      const size = 21;
      const modules = createMockModules(size);
      const noSolutionConfig = { ...baseConfig, showMazeSolution: false };

      renderMaze(ctx, modules, noSolutionConfig, 0, 0, 10, size, generateMaze(modules, noSolutionConfig, size));

      // Verify we only stroke once for the maze edges and skip the solution path
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it('handles rendering with null start or end or key nodes', () => {
      const ctx = createMockCtx();
      const mockMazeData = {
        nodes: [],
        edges: [],
        start: null,
        end: null,
        key: null,
        solution: [],
      };
      const size = 21;
      const modules = createMockModules(size);

      renderMaze(ctx, modules, baseConfig, 0, 0, 10, size, mockMazeData);

      // Should not call arc since start/end/key are null
      expect(ctx.arc).not.toHaveBeenCalled();
    });

    it('renders gold concentric circle marker at mathematical midpoint key position', () => {
      const ctx = createMockCtx();
      const size = 21;
      const modules = createMockModules(size);
      const mockMazeData = {
        nodes: [],
        edges: [],
        start: null,
        end: null,
        key: { r: 5, c: 10 },
        solution: [{ r: 0, c: 0 }, { r: 5, c: 10 }, { r: 10, c: 10 }],
      };

      const cellSize = 12;
      const drawX = 0;
      const drawY = 0;

      renderMaze(ctx, modules, baseConfig, drawX, drawY, cellSize, size, mockMazeData);

      // Calculate expected coordinates for key at (r: 5, c: 10)
      const expectedKx = drawX + (10 + 0.5) * cellSize; // 126
      const expectedKy = drawY + (5 + 0.5) * cellSize;  // 66

      // Outer ring: radius = 12 * 0.35 = 4.2, fillStyle = 'rgba(234, 179, 8, 0.3)'
      // Inner dot: radius = 12 * 0.18 = 2.16, fillStyle = '#eab308'
      expect(ctx.arc).toHaveBeenCalledWith(expectedKx, expectedKy, cellSize * 0.35, 0, 2 * Math.PI);
      expect(ctx.arc).toHaveBeenCalledWith(expectedKx, expectedKy, cellSize * 0.18, 0, 2 * Math.PI);
    });

    it('scales key marker proportionally when cell size changes', () => {
      const ctx = createMockCtx();
      const size = 21;
      const modules = createMockModules(size);
      const mockMazeData = {
        nodes: [],
        edges: [],
        start: null,
        end: null,
        key: { r: 2, c: 3 },
        solution: [],
      };

      const cellSizeLarge = 20;
      renderMaze(ctx, modules, baseConfig, 0, 0, cellSizeLarge, size, mockMazeData);

      const expectedKx = (3 + 0.5) * cellSizeLarge; // 70
      const expectedKy = (2 + 0.5) * cellSizeLarge; // 50

      expect(ctx.arc).toHaveBeenCalledWith(expectedKx, expectedKy, cellSizeLarge * 0.35, 0, 2 * Math.PI);
      expect(ctx.arc).toHaveBeenCalledWith(expectedKx, expectedKy, cellSizeLarge * 0.18, 0, 2 * Math.PI);
    });

    it('covers all branch conditions in isFinderPatternWithMargin', () => {
      const size = 21;
      // Condition 1: r >= -2 && r <= 8 && c >= -2 && c <= 8
      expect(isFinderPatternWithMargin(-3, 0, size)).toBe(false); // r < -2
      expect(isFinderPatternWithMargin(9, 0, size)).toBe(false);  // r > 8
      expect(isFinderPatternWithMargin(0, -3, size)).toBe(false); // c < -2
      expect(isFinderPatternWithMargin(0, 9, size)).toBe(false);  // c > 8

      // Condition 2: r >= -2 && r <= 8 && c >= size - 9 && c <= size + 4
      expect(isFinderPatternWithMargin(0, size - 10, size)).toBe(false); // c < size - 9
      expect(isFinderPatternWithMargin(0, size + 5, size)).toBe(false);  // c > size + 4

      // Condition 3: r >= size - 9 && r <= size + 4 && c >= -2 && c <= 8
      expect(isFinderPatternWithMargin(size - 10, 0, size)).toBe(false); // r < size - 9
      expect(isFinderPatternWithMargin(size + 5, 0, size)).toBe(false);  // r > size + 4
    });

    it('covers all branch conditions in isBridgeCell', () => {
      const size = 21;
      // Condition 1: c === 3 && r === 8
      expect(isBridgeCell(8, 3, size)).toBe(true);
      expect(isBridgeCell(7, 3, size)).toBe(false); // r !== 8
      expect(isBridgeCell(9, 3, size)).toBe(false); // r !== 8
      expect(isBridgeCell(8, 4, size)).toBe(false); // c !== 3

      // Condition 2: c === size - 4 && r === 8
      expect(isBridgeCell(8, size - 4, size)).toBe(true);
      expect(isBridgeCell(7, size - 4, size)).toBe(false); // r !== 8
      expect(isBridgeCell(9, size - 4, size)).toBe(false); // r !== 8
      expect(isBridgeCell(8, size - 5, size)).toBe(false); // c !== size - 4

      // Condition 3: r === size - 4 && c === 8
      expect(isBridgeCell(size - 4, 8, size)).toBe(true);
      expect(isBridgeCell(size - 4, 7, size)).toBe(false); // c !== 8
      expect(isBridgeCell(size - 4, 9, size)).toBe(false); // c !== 8
      expect(isBridgeCell(size - 5, 8, size)).toBe(false); // r !== size - 4
    });

    it('covers process.env.NODE_ENV cache and empty nodes branch', () => {
      const size = 21;
      const modules = createMockModules(size);
      
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // Run once to cache
        generateMaze(modules, baseConfig, size);
        // Run again to hit cache
        const cachedMaze = generateMaze(modules, baseConfig, size);
        expect(cachedMaze).toBeDefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }

      // Generate with empty nodes by passing negative size
      const emptyMaze = generateMaze(modules, baseConfig, -10);
      expect(emptyMaze.nodes.length).toBe(0);
      expect(emptyMaze.start).toBeNull();
    });

    it('renders with custom mazePathWidth and custom colors', () => {
      const ctx = createMockCtx();
      const size = 21;
      const modules = createMockModules(size);
      const customConfig = {
        ...baseConfig,
        mazePathWidth: 0.5,
        mazeColor: undefined, // test default color path too
      };

      renderMaze(ctx, modules, customConfig, 0, 0, 10, size, generateMaze(modules, customConfig, size));
      expect(ctx.save).toHaveBeenCalled();
    });

    it('covers dark module on a bridge cell', () => {
      const size = 21;
      // Bridge cell (8, 3) is set as dark module
      const modules = createMockModules(size, { '8,3': true });
      const configWithBridges = { ...baseConfig, isMazeBridgesEnabled: true };
      const mazeData = generateMaze(modules, configWithBridges, size);

      // Verify that (8, 3) is STILL present as a node in the maze because it is a bridge!
      const bridgeNode = mazeData.nodes.find(n => n.r === 8 && n.c === 3);
      expect(bridgeNode).toBeDefined();
    });

    it('covers special edge case branches for 100 percent coverage', () => {
      const size = 21;
      const modules = createMockModules(size);

      // 1. Empty value to test seedRandom('') empty loop branch
      const emptyValConfig = { ...baseConfig, value: '' };
      generateMaze(modules, emptyValConfig, size);

      // 2. Single node grid (where all except one cell are dark) to test bestEnd/solution null
      const singleNodeMap: Record<string, boolean> = {};
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if (!(r === 9 && c === 9)) singleNodeMap[`${r},${c}`] = true;
        }
      }
      const singleNodeModules = createMockModules(10, singleNodeMap);
      const singleNodeMaze = generateMaze(singleNodeModules, { ...baseConfig, isMazeBridgesEnabled: false }, 10);
      expect(singleNodeMaze.nodes.length).toBe(1);
      expect(singleNodeMaze.start).toBeNull();

      // 3. Small grid where solved path is <= 10 steps, testing dynamic step threshold adaptation
      const smallGridModules = createMockModules(12);
      const smallGridMaze = generateMaze(smallGridModules, { ...baseConfig, isMazeBridgesEnabled: false }, 12);
      expect(smallGridMaze.nodes.length).toBeGreaterThan(1);
      expect(smallGridMaze.solution.length).toBeGreaterThan(1); // dynamically adapted step threshold produces solvable path
    });

    it('connects fragmented components by adding connector cells', () => {
      const size = 21;
      // Create three disconnected components separated by dark modules in columns 7 and 14
      const wallMap: Record<string, boolean> = {};
      for (let r = 0; r < size; r++) {
        wallMap[`${r},7`] = true;
        wallMap[`${r},14`] = true;
      }
      const modules = createMockModules(size, wallMap);
      const configNoBridges = { ...baseConfig, isMazeBridgesEnabled: false };
      const mazeData = generateMaze(modules, configNoBridges, size);

      // Verify connector cells in column 7 and column 14 were added as nodes
      expect(mazeData.nodes.some(n => n.c === 7)).toBe(true);
      expect(mazeData.nodes.some(n => n.c === 14)).toBe(true);
    });

    it('handles unsolvable multi-component maze with mixed component sizes by using fallback component tree diameter', () => {
      const size = 21;
      const wallMap: Record<string, boolean> = {};
      // Wall of 2 dark columns (col 9 and 10) so main components cannot be bridged
      for (let r = 0; r < size; r++) {
        wallMap[`${r},9`] = true;
        wallMap[`${r},10`] = true;
      }
      // Create an isolated single-node component at (10, 2) (outside finder pattern areas)
      // surrounded by 2 layers of dark cells so connector cells cannot bridge it
      for (let r = 8; r <= 12; r++) {
        for (let c = 0; c <= 4; c++) {
          wallMap[`${r},${c}`] = true;
        }
      }
      // Leave (10, 2) light
      delete wallMap['10,2'];

      const modules = createMockModules(size, wallMap);
      const configNoBridges = { ...baseConfig, isMazeBridgesEnabled: false };
      const mazeData = generateMaze(modules, configNoBridges, size);

      expect(mazeData.start).not.toBeNull();
      expect(mazeData.end).not.toBeNull();
      expect(mazeData.solution.length).toBeGreaterThan(1);
    });

    it('handles isolated single-node components where no path can be formed', () => {
      const size = 21;
      const wallMap: Record<string, boolean> = {};
      // Set all cells in the matrix to dark
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          wallMap[`${r},${c}`] = true;
        }
      }
      // Leave two light cells far apart outside finder eye patterns
      delete wallMap['10,2'];
      delete wallMap['10,18'];

      const modules = createMockModules(size, wallMap);
      const configNoBridges = { ...baseConfig, isMazeBridgesEnabled: false };
      const mazeData = generateMaze(modules, configNoBridges, size);

      expect(mazeData.start).toBeNull();
      expect(mazeData.end).toBeNull();
      expect(mazeData.solution.length).toBe(0);
    });
  });
});

describe('getStyleAdaptiveMazePathWidth & Style-Adaptive Clearance', () => {
  it('returns style-adaptive defaults for custom stylized modules', () => {
    expect(getStyleAdaptiveMazePathWidth(QRStyle.STARBURST)).toBe(0.12);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.HIVE)).toBe(0.15);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.FLUID)).toBe(0.18);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.CIRCUIT)).toBe(0.18);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.SWISS)).toBe(0.20);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.STANDARD)).toBe(0.25);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.MODERN)).toBe(0.25);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.GRUNGE)).toBe(0.25);
  });

  it('respects manual path width overrides within 0.10 to 0.50 range', () => {
    expect(getStyleAdaptiveMazePathWidth(QRStyle.STARBURST, 0.35)).toBe(0.35);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.HIVE, 0.45)).toBe(0.45);
  });

  it('enforces guardrail min limit (0.10) and max limit (0.50)', () => {
    expect(getStyleAdaptiveMazePathWidth(QRStyle.STARBURST, 0.02)).toBe(0.10);
    expect(getStyleAdaptiveMazePathWidth(QRStyle.FLUID, 0.80)).toBe(0.50);
  });
});

describe('applyMazeHaloMask & Canvas Clearance', () => {
  it('applies destination-out composite masking to clear maze paths overlapping styled modules', () => {
    const size = 21;
    const darkMap: Record<string, boolean> = { '10,10': true };
    const modules = {
      size,
      get: (r: number, c: number) => !!darkMap[`${r},${c}`],
    };

    const ctx = {
      beginPath: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const starburstConfig = {
      value: 'https://qrcraftly.com',
      type: QRType.URL,
      fgColor: '#000000',
      bgColor: '#ffffff',
      style: QRStyle.STARBURST,
      isMazeEnabled: true,
      mazeColor: '#3b82f6',
    } as any;

    renderMaze(ctx, modules, starburstConfig, 0, 0, 10, size, generateMaze(modules, starburstConfig, size));

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });
});
