/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { render, screen, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import QRCanvas from './QRCanvas';
import { DEFAULT_CONFIG } from '../constants';
import {
  QRStyle,
  LogoPaddingStyle,
  QRErrorCorrectionLevel,
  SocialFormat,
  QRType,
  QRConfig,
} from '../types';
import { createFakeQrEncoder, useCanvasEncoder } from '../../tests/fixtures/fakeQrEncoder';
import { qrEncoder } from '../../tests/fixtures/qrEncoder';
import { setQrCanvasRuntime } from '../utils/qrCanvasRuntime';
import React from 'react';

const QRCode = createFakeQrEncoder();

/**
 * getContext is already a mock from vitest.setup.ts, so `vi.spyOn` in the specs below reuses it and
 * replaces its implementation. Put the setup's pixel-tracking context back after every test.
 */
const setupGetContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation();
afterEach(() => {
  if (setupGetContext) vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(setupGetContext);
});

/** A spy-backed 2D context covering every canvas call QRCanvas makes. */
function createMockContext() {
  const mockGradient = {
    addColorStop: vi.fn(),
  };
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue(mockGradient),
    createRadialGradient: vi.fn().mockReturnValue(mockGradient),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 10 }),
    canvas: { width: 0, height: 0 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

/** Replaces window.Image with an inert stand-in that never loads; specs trigger onload themselves. */
function stubWindowImage(onCreate?: (image: object) => void) {
  window.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    complete = false;
    crossOrigin = '';
    constructor() {
      onCreate?.(this);
    }
  } as unknown as typeof Image;
}

describe('QRCanvas Component', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let mockModules: any;
  let createdImages: any[];

  beforeEach(() => {
    vi.clearAllMocks(); // Clear call history

    // Setup Mock Canvas Context
    mockContext = createMockContext();

    // Mock getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return mockContext;
      }
      return null;
    });

    // Setup Mock QRCode Data
    const size = 21;
    mockModules = {
      size: size,
      get: vi.fn().mockReturnValue(false),
    };
    
    // Default mock implementation for get
    mockModules.get.mockImplementation((r: number, c: number) => {
        if (r === 0 && c === 0) return true;
        return false;
    });

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    createdImages = [];
    stubWindowImage(image => createdImages.push(image));
  });

  
  it('renders correctly with default config', async () => {
    render(<QRCanvas config={DEFAULT_CONFIG} />);

    const canvas = screen.getByRole('img');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('QR Code for Url'));

    await waitFor(() => {
        expect(QRCode.create).toHaveBeenCalledWith(DEFAULT_CONFIG.value, { errorCorrectionLevel: QRErrorCorrectionLevel.H });
    });

    await waitFor(() => {
        expect(mockContext.clearRect).toHaveBeenCalled();
        expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);

        // Check drawing
        // expect(mockContext.beginPath).toHaveBeenCalled(); // STANDARD uses fillRect mainly
        expect(mockContext.fillRect).toHaveBeenCalled();
    });
  });

  it('renders different styles correctly (SWISS)', async () => {
    const config = { ...DEFAULT_CONFIG, style: QRStyle.SWISS };
    render(<QRCanvas config={config} />);

    await waitFor(() => {
         expect(QRCode.create).toHaveBeenCalled();
    });

    // SWISS uses arc for modules and eyes
    await waitFor(() => {
        expect(mockContext.arc).toHaveBeenCalled();
    });
  });

  it('draws rounded rects for data modules when style is MODERN', async () => {
     mockModules.get.mockImplementation((r: number, c: number) => {
        if (r === 10 && c === 10) return true; 
        return false;
     });
     
     const config = { ...DEFAULT_CONFIG, style: QRStyle.MODERN };
     render(<QRCanvas config={config} />);
     
     await waitFor(() => {
        // Modern uses roundedRect (or shim)
        expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
     });
  });

  it('draws star for data modules when style is STARBURST', async () => {
      mockModules.get.mockImplementation((r: number, c: number) => {
          if (r === 10 && c === 10) return true;
          return false;
      });

      const config = { ...DEFAULT_CONFIG, style: QRStyle.STARBURST };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          // Star uses lineTo loop
          expect(mockContext.lineTo).toHaveBeenCalled();
          expect(mockContext.closePath).toHaveBeenCalled();
      });
  });

  it('draws hexagon for HIVE style', async () => {
      mockModules.get.mockImplementation((r: number, c: number) => {
          if (r === 10 && c === 10) return true;
          return false;
      });

      const config = { ...DEFAULT_CONFIG, style: QRStyle.HIVE };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
         // Hexagon loop 6 times
         expect(mockContext.lineTo).toHaveBeenCalled();
      });
  });

  it('handles logo rendering', async () => {
    const config = { ...DEFAULT_CONFIG, logoUrl: 'https://example.com/logo.png' };
    
    render(<QRCanvas config={config} />);

    // Wait for image to be created
    await waitFor(() => {
        expect(createdImages.length).toBeGreaterThan(0);
    });

    const img = createdImages[0];
    
    // Simulate load
    act(() => {
      if (img.onload) {
          img.complete = true;
          img.onload();
      }
    });

    await waitFor(() => {
        expect(mockContext.drawImage).toHaveBeenCalled();
    });
  });

  it('renders logo with circle padding', async () => {
      const config = {
          ...DEFAULT_CONFIG,
          logoUrl: 'https://example.com/logo.png',
          logoPaddingStyle: 'circle' as LogoPaddingStyle
      };

      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(createdImages.length).toBeGreaterThan(0);
      });
      const img = createdImages[0];
      act(() => {
        if (img.onload) { img.complete = true; img.onload(); }
      });

      await waitFor(() => {
          // Should draw a circle background (arc)
          expect(mockContext.arc).toHaveBeenCalled();
          expect(mockContext.drawImage).toHaveBeenCalled();
      });
  });

  it('renders logo with square padding', async () => {
      const config = {
          ...DEFAULT_CONFIG,
          logoUrl: 'https://example.com/logo.png',
          logoPaddingStyle: 'square' as LogoPaddingStyle
      };

      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(createdImages.length).toBeGreaterThan(0);
      });
      const img = createdImages[0];
      act(() => {
        if (img.onload) { img.complete = true; img.onload(); }
      });

      await waitFor(() => {
          // Should draw a rect background
          expect(mockContext.fillRect).toHaveBeenCalled();
          expect(mockContext.drawImage).toHaveBeenCalled();
      });
  });

  it('does not draw logo background when padding style is none', async () => {
      const config = {
          ...DEFAULT_CONFIG,
          logoUrl: 'https://example.com/logo.png',
          logoPaddingStyle: 'none' as LogoPaddingStyle
      };

      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(createdImages.length).toBeGreaterThan(0);
      });
      const img = createdImages[0];

      // Reset mock to check for subsequent calls
      mockContext.fillRect.mockClear();
      mockContext.arc.mockClear();
      mockContext.drawImage.mockClear();

      act(() => {
        if (img.onload) { img.complete = true; img.onload(); }
      });

      await waitFor(() => {
          expect(mockContext.drawImage).toHaveBeenCalled();
      });

      // Should NOT draw background for logo
      // Since we optimized rendering to do a full redraw on image load, we expect main background calls.
      // But we shouldn't see a "logo padding" call.
      // Standard QR: 1 bg + 1 module (0,0) + 3 eyes (2 fillRects each) = 8 calls?
      // Wait, eyes have fillRect (frame), clearShape, fillRect (hole), fillRect (eyeball)?
      // Standard Eye: fillRect (frame), clearShape -> clearRect, fillRect (hole), fillRect (eyeball).
      // So 3 fillRects per eye.
      // 3 * 3 = 9.
      // Background = 1.
      // Total 10.
      // Depending on re-renders, this might be 10 or 20
      expect([10, 20]).toContain(mockContext.fillRect.mock.calls.length);
      expect(mockContext.arc).not.toHaveBeenCalled();
  });

  it('handles logo loading error', async () => {
      const config = { ...DEFAULT_CONFIG, logoUrl: 'https://example.com/bad-logo.png' };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(createdImages.length).toBeGreaterThan(0);
      });
      const img = createdImages[0];

      // Simulate error
      act(() => {
        if (img.onerror) {
            img.onerror();
        }
      });

      // Should still finish rendering but without logo
      await waitFor(() => {
          // drawImage should NOT be called for the logo
          expect(mockContext.drawImage).not.toHaveBeenCalled();

          // Data modules are drawn using various context methods depending on style.
          // In standard mode, we might expect fillRect or rect.
          // Or at least, fill should be called for eye rendering or modules.
          // BUT, if mockModules.get returns false (except 0,0), we might not see many calls.
          // Let's just check that fillRect was called (for background)
          expect(mockContext.fillRect).toHaveBeenCalled();
      });
  });

  it('handles QR generation failure', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Make QRCode.create throw
      (QRCode.create as unknown as Mock).mockImplementationOnce(() => {
          throw new Error('Generation failed');
      });

      render(<QRCanvas config={DEFAULT_CONFIG} />);

      await waitFor(() => {
          expect(consoleSpy).toHaveBeenCalledWith("QR generation failed:", expect.any(Error));
      });

      consoleSpy.mockRestore();
  });

  it('does not render if value is empty', async () => {
    const config = { ...DEFAULT_CONFIG, value: '' };
    render(<QRCanvas config={config} />);
    
    await waitFor(() => {
       expect(mockContext.clearRect).toHaveBeenCalled();
    });
    
    expect(QRCode.create).not.toHaveBeenCalled();
  });

  it('does not render if value is empty and template mode is enabled', async () => {
    const config = { ...DEFAULT_CONFIG, value: '', enableTemplate: true, socialFormat: SocialFormat.STORY_9_16 };
    render(<QRCanvas config={config} size={1080} />);

    await waitFor(() => {
       expect(mockContext.clearRect).toHaveBeenCalled();
    });

    expect(QRCode.create).not.toHaveBeenCalled();

    // Check that canvas was sized correctly based on template height ratio
    const canvasElement = document.querySelector('canvas');
    expect(canvasElement?.width).toBe(1080);
    // STORY_9_16 height ratio = 1920 / 1080 = 1.7777...
    // Expected height = 1080 * 1.7777... = 1920
    expect(canvasElement?.height).toBe(1920);
  });

  it('should ensure the logo cutout does not exceed safe error correction limits', async () => {
    // Setup a scenario where user config would break the QR code
    // Version 3 (29x29)
    // Logo Size 0.35
    // Padding 4 modules

    // We mock the modules size to be small to exaggerate the issue
    const moduleCount = 29;
    mockModules.size = moduleCount;

    const dangerousConfig = {
      ...DEFAULT_CONFIG,
      value: 'https://example.com',
      logoUrl: 'https://example.com/logo.png', // valid url to trigger image loading
      logoSize: 0.35,
      logoPaddingStyle: 'square' as LogoPaddingStyle,
      logoPadding: 4,
    };

    render(<QRCanvas config={dangerousConfig} size={100} />);

    await waitFor(() => {
        expect(createdImages.length).toBeGreaterThan(0);
    });

    const img = createdImages[0];
    act(() => {
      if (img.onload) { img.complete = true; img.onload(); }
    });

    await waitFor(() => {
        // Find the logo background call. It should be the one centered.
        // displaySize 100. Center 50.
        const fillRectCalls = mockContext.fillRect.mock.calls;
        const logoBgCall = fillRectCalls.find((args: any[]) => {
            const [x, _y, w, h] = args;
            // Check if it's roughly square and centered
            return Math.abs(w - h) < 0.1 && w > 20 && w < 90 && Math.abs(x - (100-w)/2) < 2;
        });

        expect(logoBgCall).toBeDefined();
        const drawnWidth = logoBgCall[2];
        const relativeWidth = drawnWidth / 100;

        // This assertion ensures the fix is working
        // We want the relative width to be <= 0.50 (SAFE_AREA_RATIO) + buffer
        expect(relativeWidth).toBeLessThanOrEqual(0.51);
    });
  });

  it('displays the standard Alert component with polite live region when validation fails', async () => {
    const invalidConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'javascript:alert(1)',
    };

    render(<QRCanvas config={invalidConfig} />);

    // Check that standard alert is used with status role and polite live region
    const alertElement = screen.getByRole('status');
    expect(alertElement).toBeInTheDocument();
    expect(alertElement).toHaveAttribute('aria-live', 'polite');

    // Check that warning message is rendered
    expect(screen.getByText('Unsafe URL scheme or malicious protocol detected.')).toBeInTheDocument();
    expect(screen.getByText('Generation Blocked:')).toBeInTheDocument();

    // Check that decorative icon inside has aria-hidden="true"
    const iconElement = alertElement.querySelector('svg');
    expect(iconElement).toBeInTheDocument();
    expect(iconElement).toHaveAttribute('aria-hidden', 'true');

    // Check that underlying canvas remains mounted in the background (hidden)
    const canvasElement = document.querySelector('canvas');
    expect(canvasElement).toBeInTheDocument();
    expect(canvasElement).toHaveStyle({ display: 'none' });
  });

  it('handles window.devicePixelRatio and requestIdleCallback being undefined safely', async () => {
    const originalRatio = window.devicePixelRatio;
    const originalIdleCallback = (window as any).requestIdleCallback;

    try {
      // Temporarily set them to undefined
      Object.defineProperty(window, 'devicePixelRatio', { value: undefined, configurable: true, writable: true });
      delete (window as any).requestIdleCallback;

      const { container } = render(<QRCanvas config={DEFAULT_CONFIG} size={100} />);
      const canvasElement = container.querySelector('canvas');
      expect(canvasElement).toBeInTheDocument();
    } finally {
      // Restore
      Object.defineProperty(window, 'devicePixelRatio', { value: originalRatio, configurable: true, writable: true });
      if (originalIdleCallback) {
        (window as any).requestIdleCallback = originalIdleCallback;
      }
    }
  });

  describe('Off-Thread Maze Pathfinder Web Worker Integration', () => {
    it('initializes and triggers background maze worker on config update if isMazeEnabled is true', async () => {
      const postMessageMock = vi.fn();
      const terminateMock = vi.fn();
      
      class MockWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage = postMessageMock;
        terminate = terminateMock;
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
      }

      // Inject a maze worker through the runtime seam; the matrix stays on the main thread.
      const restoreRuntime = setQrCanvasRuntime({
        createMazeWorker: () => new MockWorker() as unknown as Worker,
      });

      try {
        const mazeConfig = {
          ...DEFAULT_CONFIG,
          isMazeEnabled: true,
          mazeColor: '#ff0000',
        };

        const { rerender } = render(<QRCanvas config={mazeConfig} size={100} />);
        
        // Wait a short tick for mount effects to fully resolve and initialize workers
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });

        // Trigger config update to dispatch calculation to the active worker
        rerender(<QRCanvas config={{ ...mazeConfig, value: 'https://qrcraftly.com/updated-test' }} size={100} />);

        await waitFor(() => {
          expect(postMessageMock).toHaveBeenCalled();
        });

        const firstPayload = postMessageMock.mock.calls[0][0];
        expect(firstPayload).toHaveProperty('size');
        expect(firstPayload).toHaveProperty('matrix');
        expect(firstPayload).toHaveProperty('config');
        expect(firstPayload).toHaveProperty('sequenceId');
      } finally {
        restoreRuntime();
      }
    });

    it('falls back to main-thread pathfinding calculation using requestIdleCallback if Worker throws', async () => {
      const restoreRuntime = setQrCanvasRuntime({
        createMazeWorker: () => {
          throw new Error('Worker blocked');
        },
      });

      try {
        const mazeConfig = {
          ...DEFAULT_CONFIG,
          isMazeEnabled: true,
          mazeColor: '#00ff00',
        };

        const spyGenerateMaze = vi.spyOn(await import('@/packages/qr-matrix/maze'), 'generateMaze');
        render(<QRCanvas config={mazeConfig} size={100} />);

        await waitFor(() => {
          expect(spyGenerateMaze).toHaveBeenCalled();
        });
      } finally {
        restoreRuntime();
      }
    });

    it('seamlessly reverts bridges to standard safety zones if scannability-fail is emitted', async () => {
      const mazeConfig = {
        ...DEFAULT_CONFIG,
        isMazeEnabled: true,
        isMazeBridgesEnabled: true,
      };

      const spyGenerateMaze = vi.spyOn(await import('@/packages/qr-matrix/maze'), 'generateMaze');

      const { QRProvider, useQRStore } = await import('../context/QRContext');
      let storeRef: any;

      const TestComponent = () => {
        const store = useQRStore();
        storeRef = store;
        return <QRCanvas config={mazeConfig} size={100} />;
      };

      render(
        <QRProvider>
          <TestComponent />
        </QRProvider>
      );

      // Verify it was initially generated with bridges enabled (default is true or explicitly true)
      await waitFor(() => {
        expect(spyGenerateMaze).toHaveBeenCalled();
      });
      const initialCallConfig = spyGenerateMaze.mock.calls[0][1];
      expect(initialCallConfig.isMazeBridgesEnabled).not.toBe(false);

      // Clear spy calls history
      spyGenerateMaze.mockClear();

      // Emit scannability-fail signal via the store
      await act(async () => {
        storeRef.emitSignal('scannability-fail', { errorType: 'TEST' });
      });

      // Verify that generateMaze gets called again, this time with isMazeBridgesEnabled set to false
      await waitFor(() => {
        const fallbackCall = spyGenerateMaze.mock.calls.find(call => call[1].isMazeBridgesEnabled === false);
        expect(fallbackCall).toBeDefined();
      });
    });
  });
});

describe('QRCanvas Rendering Logic Extended', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let mockModules: any;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear call history

    // Setup Mock Canvas Context
    mockContext = createMockContext();

    // Mock getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return mockContext;
      }
      return null;
    });

    // Setup Mock QRCode Data
    const size = 21;
    mockModules = {
      size: size,
      get: vi.fn().mockReturnValue(false),
    };

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    stubWindowImage();
  });

  
  // Helper to trigger specific module state
  const setModule = (r: number, c: number, val: boolean) => {
      mockModules.get.mockImplementation((row: number, col: number) => {
          if (row === r && col === c) return val;
          return false;
      });
  };

  it('draws FLUID style correctly (using curves)', async () => {
      setModule(10, 10, true);
      const config = { ...DEFAULT_CONFIG, style: QRStyle.FLUID };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
          expect(mockContext.fill).toHaveBeenCalled();
      });
  });

  it('draws GRUNGE style correctly (using rough rect / rotation)', async () => {
      setModule(10, 10, true);
      const config = { ...DEFAULT_CONFIG, style: QRStyle.GRUNGE };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.save).toHaveBeenCalled();
          expect(mockContext.rotate).toHaveBeenCalled();
          expect(mockContext.restore).toHaveBeenCalled();
          expect(mockContext.fillRect).toHaveBeenCalled();
      });
  });

  it('draws CIRCUIT style correctly (full square + notches)', async () => {
      setModule(10, 10, true);
      const config = { ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          // Should use roundRect for the main body
          expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
          expect(mockContext.fill).toHaveBeenCalled();
          // And potentially fillRect for connections (though none here)
      });
  });

  it('draws Border DOTTED style', async () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderStyle: 'dotted' as const, borderSize: 0.1 };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.setLineDash).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
          expect(mockContext.strokeRect).toHaveBeenCalled();
      });
  });

  it('draws Border DOUBLE style', async () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderStyle: 'double' as const, borderSize: 0.1 };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          // Double style just draws a strokeRect with offset
          expect(mockContext.strokeRect).toHaveBeenCalled();
          // It doesn't use setLineDash
          expect(mockContext.setLineDash).not.toHaveBeenCalledWith(expect.any(Array));
      });
  });

  it('draws Border Text Top Center', async () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderText: 'TEST', borderTextPosition: 'top-center' as const };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.fillText).toHaveBeenCalledWith('TEST', expect.any(Number), expect.any(Number));
          // Verify Y position is small (near top)
          const call = mockContext.fillText.mock.calls[0];
          expect(call[2]).toBeLessThan(1024 / 2); // y < half height
      });
  });

  it('uses manual drawRoundRect fallback if ctx.roundRect is missing', async () => {
      // Delete roundRect from mock
      mockContext.roundRect = undefined;

      setModule(10, 10, true);
      const config = { ...DEFAULT_CONFIG, style: QRStyle.MODERN }; // Modern uses roundRect
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
          expect(mockContext.moveTo).toHaveBeenCalled();
          expect(mockContext.lineTo).toHaveBeenCalled();
          expect(mockContext.closePath).toHaveBeenCalled();
      });
  });

  it('draws different eye patterns correctly', async () => {
     // We just want to ensure specific calls happen for eyes.
     // Eyes are drawn at (0,0), (0, 14), (14, 0) relative to modules... wait size is 21.
     // Eyes are top-left, top-right, bottom-left.

     // Check FLUID Eye
     const fluidConfig = { ...DEFAULT_CONFIG, style: QRStyle.FLUID };
     render(<QRCanvas config={fluidConfig} />);
     await waitFor(() => {
         // Fluid eye uses drawRoundRect for both frame and (squircle) pupil
         expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
         expect(mockContext.arc).not.toHaveBeenCalled();
     });

     // Reset mocks
     vi.clearAllMocks();

     // Check STARBURST Eye
     const starConfig = { ...DEFAULT_CONFIG, style: QRStyle.STARBURST };
     render(<QRCanvas config={starConfig} />);
     await waitFor(() => {
         // Starburst uses fillRect for frame (square) and drawStar for pupil
         // drawStar uses many lineTo calls
         expect(mockContext.lineTo).toHaveBeenCalled();
     });

     // Reset mocks
     vi.clearAllMocks();

     // Check GRUNGE Eye
     const grungeConfig = { ...DEFAULT_CONFIG, style: QRStyle.GRUNGE };
     render(<QRCanvas config={grungeConfig} />);
     await waitFor(() => {
         // Grunge uses drawRoughRect (rotate) and drawScribble (rotate + loop)
         expect(mockContext.rotate).toHaveBeenCalled();
     });
  });

  it('renders linear and radial gradient fills across QR code modules', async () => {
     setModule(10, 10, true);
     const linearConfig: QRConfig = {
       ...DEFAULT_CONFIG,
       gradientType: 'linear',
       gradientColorStops: [
         { offset: 0, color: '#ff0000' },
         { offset: 1, color: '#0000ff' },
       ],
       gradientAngle: 180,
     };

     const { rerender } = render(<QRCanvas config={linearConfig} />);

     await waitFor(() => {
       expect(mockContext.createLinearGradient).toHaveBeenCalled();
     });

     const radialConfig: QRConfig = {
       ...DEFAULT_CONFIG,
       gradientType: 'radial',
       gradientColorStops: [
         { offset: 0, color: '#00ff00' },
         { offset: 1, color: '#ff00ff' },
       ],
     };

     rerender(<QRCanvas config={radialConfig} />);

     await waitFor(() => {
       expect(mockContext.createRadialGradient).toHaveBeenCalled();
     });
  });
});

describe('QRCanvas Batch Rendering', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let mockModules: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = createMockContext();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockContext);

    // 21x21 modules
    mockModules = {
      size: 21,
      get: vi.fn().mockReturnValue(false),
    };

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    stubWindowImage();
  });

  
  const setModulesPattern = () => {
      // Set a few modules to true to trigger drawing
      mockModules.get.mockImplementation((r: number, c: number) => {
          // Activate a block of modules (6x6 = 36 modules)
          // Avoid eyes (0-7, 0-7 etc)
          if (r > 8 && r < 15 && c > 8 && c < 15) return true;
          return false;
      });
  };

  it('batches HIVE style (drawPoly) calls', async () => {
      setModulesPattern();
      const config = { ...DEFAULT_CONFIG, style: QRStyle.HIVE };
      render(<QRCanvas config={config} />);

      // Wait for drawing to happen
      await waitFor(() => {
          expect(mockContext.fill).toHaveBeenCalled();
      });

      const fillCallCount = mockContext.fill.mock.calls.length;

      // With optimization: fill should be called once for background + once for modules batch + 3 eyes = ~5
      // Without optimization: fill called for every module (36) + eyes + background = >40
      expect(fillCallCount).toBeLessThan(10);
  });

  it('batches STARBURST style (drawStar) calls', async () => {
      setModulesPattern();
      const config = { ...DEFAULT_CONFIG, style: QRStyle.STARBURST };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
          expect(mockContext.fill).toHaveBeenCalled();
      });

      const fillCallCount = mockContext.fill.mock.calls.length;
      expect(fillCallCount).toBeLessThan(10);
  });

  it('batches GRUNGE style (drawRoughRect) calls', async () => {
      setModulesPattern();
      const config = { ...DEFAULT_CONFIG, style: QRStyle.GRUNGE };
      render(<QRCanvas config={config} />);

      await waitFor(() => {
        // Wait for rendering to start.
        // In unoptimized mode, fillRect is called.
        // In optimized mode, fill is called.
        // So we wait for clearRect which means render cycle started,
        // but we need to wait for actual drawing commands.
        // Let's wait for fillRect (background uses it)
        expect(mockContext.fillRect).toHaveBeenCalled();
      });

      // Allow some time for module loop to finish if it's async/heavy?
      // No, it's synchronous inside useEffect.

      const fillRectCount = mockContext.fillRect.mock.calls.length;

      // With optimization: fillRect only used for eyes (frames + holes) + background = ~4-10
      // Modules use rect().
      // Without optimization: fillRect called for every module (36) + eyes + background = >40
      expect(fillRectCount).toBeLessThan(20);

      // And we expect fill() to be called for the modules batch (if optimized)
      // If unoptimized, fill() is NOT called for modules (only background if border enabled? No default border is disabled).
      // Wait, background uses fillRect.
      expect(mockContext.fill).toHaveBeenCalled();
  });
});

describe('QRCanvas Circuit Style Bug', () => {
  useCanvasEncoder(QRCode);

  let mockModules: any;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear call history

    // Setup Mock QRCode Data
    const size = 21;
    mockModules = {
      size: size,
      get: vi.fn().mockReturnValue(false),
    };

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    stubWindowImage();
  });

  it('draws traces centered on cell axes for CIRCUIT style', async () => {
     // Setup modules such that we have a connection
     // Let's test connection to the Right (col+1)
     // Cell at (10, 10) connects to (10, 11)
     mockModules.get.mockImplementation((r: number, c: number) => {
        if (r === 10 && c === 10) return true;
        if (r === 10 && c === 11) return true; // Right neighbor
        return false;
     });

     const config = { ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT, value: 'test' };
     const size = 100;
     const { container } = render(<QRCanvas config={config} size={size} />);

     await waitFor(() => {
        expect(QRCode.create).toHaveBeenCalled();
     });

     const canvas = container.querySelector('canvas') as HTMLCanvasElement;
     const ctx = canvas.getContext('2d') as any;

     // Calculate expected coordinates
     const moduleCount = 21;
     const displaySize = size; // 100
     const minBorderPx = (4 * displaySize) / (moduleCount + 8);
     const cellSize = (displaySize - 2 * minBorderPx) / moduleCount; // 100 / 21 ~= 4.76

     const r = 10;
     const c = 10;

     const x = minBorderPx + c * cellSize;
     const y = minBorderPx + r * cellSize;
     const cx = x + cellSize / 2;
     const cy = y + cellSize / 2;

     // Main cell (10, 10) should be filled
     expect(ctx.isFilled(cx, cy)).toBe(true);

     // Connected right cell (10, 11) should be filled
     expect(ctx.isFilled(cx + cellSize, cy)).toBe(true);

     // Unconnected left cell (10, 9) should be empty
     expect(ctx.isFilled(cx - cellSize, cy)).toBe(false);

     // Unconnected top cell (9, 10) should be empty
     expect(ctx.isFilled(cx, cy - cellSize)).toBe(false);

     // Unconnected bottom cell (11, 10) should be empty
     expect(ctx.isFilled(cx, cy + cellSize)).toBe(false);
  });

  it('draws vertical traces centered on cell axes for CIRCUIT style', async () => {
     // Setup modules such that we have a connection to Bottom
     // Cell at (10, 10) connects to (11, 10)
     mockModules.get.mockImplementation((r: number, c: number) => {
        if (r === 10 && c === 10) return true;
        if (r === 11 && c === 10) return true; // Bottom neighbor
        return false;
     });

     const config = { ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT, value: 'test' };
     const size = 100;
     const { container } = render(<QRCanvas config={config} size={size} />);

     await waitFor(() => {
        expect(QRCode.create).toHaveBeenCalled();
     });

     const canvas = container.querySelector('canvas') as HTMLCanvasElement;
     const ctx = canvas.getContext('2d') as any;

     const moduleCount = 21;
     const displaySize = size;
     const minBorderPx = (4 * displaySize) / (moduleCount + 8);
     const cellSize = (displaySize - 2 * minBorderPx) / moduleCount;

     const r = 10;
     const c = 10;

     const x = minBorderPx + c * cellSize;
     const y = minBorderPx + r * cellSize;
     const cx = x + cellSize / 2;
     const cy = y + cellSize / 2;

     // Main cell (10, 10) should be filled
     expect(ctx.isFilled(cx, cy)).toBe(true);

     // Connected bottom cell (11, 10) should be filled
     expect(ctx.isFilled(cx, cy + cellSize)).toBe(true);

     // Unconnected top cell (9, 10) should be empty
     expect(ctx.isFilled(cx, cy - cellSize)).toBe(false);

     // Unconnected left cell (10, 9) should be empty
     expect(ctx.isFilled(cx - cellSize, cy)).toBe(false);

     // Unconnected right cell (10, 11) should be empty
     expect(ctx.isFilled(cx + cellSize, cy)).toBe(false);
  });
});

describe('QRCanvas Circuit Style Eye Bracket Bug', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let mockModules: any;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear call history

    // Setup Mock Canvas Context
    mockContext = createMockContext();

    // Mock getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return mockContext;
      }
      return null;
    });

    // Setup Mock QRCode Data
    const size = 21;
    mockModules = {
      size: size,
      get: vi.fn().mockReturnValue(false),
    };

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    stubWindowImage();
  });

  
  it('verifies that the bracket cuts in Circuit style are deep enough (fixed)', async () => {
     const config = { ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT, value: 'test', eyeColor: '#000000', bgColor: '#ffffff' };
     const size = 100;
     render(<QRCanvas config={config} size={size} />);

     await waitFor(() => {
        expect(QRCode.create).toHaveBeenCalled();
     });

     const moduleCount = 21;
     const displaySize = size; // 100
     const minBorderPx = (4 * displaySize) / (moduleCount + 8);
     const cellSize = (displaySize - 2 * minBorderPx) / moduleCount;

     // The implementation draws the cuts using fillRect with bgColor
     // We are looking for the calls to fillRect that make the cuts
     // The fix sets depth to cellSize * 1.1

     // Top cut: ctx.fillRect(cx - gap/2, y, gap, cellSize * 1.1);

     const calls = mockContext.fillRect.mock.calls;

     // Look for the Top Cut
     // It should have height = cellSize * 1.1
     const topCutCall = calls.find((args: any[]) => {
         const [_dx, _dy, _dw, dh] = args;
         // Check dimensions
         const heightMatch = Math.abs(dh - (cellSize * 1.1)) < 0.01;
         return heightMatch;
     });

     // Expect to find the cut call
     expect(topCutCall).toBeDefined();

     // Confirm the depth is correct
     expect(topCutCall[3]).toBeCloseTo(cellSize * 1.1, 0.001);
  });
});

describe('QRCanvas Performance Refactoring', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let mockModules: any;
  let createdImages: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createdImages = [];

    mockContext = createMockContext();

    // Mock getContext
    const getContextMock = vi.fn().mockImplementation(() => mockContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContextMock);

    // Setup basic modules (21x21)
    mockModules = {
      size: 21,
      get: vi.fn(),
    };

    (QRCode.create as unknown as Mock).mockReturnValue({
      modules: mockModules,
    });

    window.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      complete = false;
      crossOrigin = '';
      naturalHeight = 100;

      constructor() {
          createdImages.push(this);
      }
    } as any;
  });

  
  const setupModules = (patternFn: (r: number, c: number) => boolean) => {
    mockModules.get.mockImplementation(patternFn);
  };

  it('renders MODERN style correctly using roundRect', async () => {
    // Activate some modules in the middle
    setupModules((r, c) => r > 8 && r < 12 && c > 8 && c < 12);

    const config = { ...DEFAULT_CONFIG, style: QRStyle.MODERN };
    render(<QRCanvas config={config} />);

    await waitFor(() => {
       // Expect roundRect to be called.
       // Note: QRCanvas uses drawRoundRect helper which might fallback to paths if roundRect is missing.
       // JSDOM canvas context might not have roundRect.
       // We mocked getContext, so mockContext DOES have roundRect spy.
       // However, drawRoundRect checks `if (ctx.roundRect)`.
       // Since our mockContext has it, it should be called.
       expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
       expect(mockContext.fill).toHaveBeenCalled();
    });
  });

  it('renders CIRCUIT style correctly', async () => {
    setupModules((r, c) => r > 8 && r < 12 && c > 8 && c < 12);

    const config = { ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT };
    render(<QRCanvas config={config} />);

    await waitFor(() => {
       expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
       expect(mockContext.rect).toHaveBeenCalled();
    });
  });

  it('handles logo exclusion correctly', async () => {
    setupModules(() => true);

    const config = {
        ...DEFAULT_CONFIG,
        logoUrl: 'https://example.com/logo.png',
        logoSize: 0.2
    };

    render(<QRCanvas config={config} />);

    await waitFor(() => {
        expect(createdImages.length).toBeGreaterThan(0);
    });

    act(() => {
        const img = createdImages[0];
        if (img && img.onload) {
            img.complete = true;
            img.onload();
        }
    });

    await waitFor(() => {
        expect(mockContext.drawImage).toHaveBeenCalled();
    });
  });

  it('renders STANDARD style using rect', async () => {
    setupModules((r, c) => r === 10 && c === 10);
    const config = { ...DEFAULT_CONFIG, style: QRStyle.STANDARD };

    render(<QRCanvas config={config} />);

    await waitFor(() => {
        expect(mockContext.rect).toHaveBeenCalled();
    });
  });
});

describe('QRCanvas Animation Loop', () => {
  useCanvasEncoder(QRCode);

  let mockContext: any;
  let rafCallback: any = null;
  let rafId = 0;
  let mockTime = 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallback = null;
    rafId = 0;
    mockTime = 1000;

    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

    mockContext = createMockContext();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return mockContext;
      }
      return null;
    });

    // Mock requestAnimationFrame to capture loop callback
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: any) => {
      rafCallback = cb;
      return ++rafId;
    });

    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    rafCallback = null;
    vi.restoreAllMocks();
  });

  it('pre-calculates and caches frame matrices, and runs animation loop', async () => {
    const animationValues = ['frame_one', 'frame_two', 'frame_three'];
    const config = {
      ...DEFAULT_CONFIG,
      animationValues,
      isAnimating: true,
      animationFps: 30,
    };

    await act(async () => {
      render(<QRCanvas config={config} />);
    });

    // Wait for the asynchronous qrcode module load and precomputation
    await vi.waitFor(() => {
      expect(QRCode.create).toHaveBeenCalledWith('frame_one', expect.any(Object));
      expect(QRCode.create).toHaveBeenCalledWith('frame_two', expect.any(Object));
      expect(QRCode.create).toHaveBeenCalledWith('frame_three', expect.any(Object));
    });

    // Verify requestAnimationFrame is called
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    expect(rafCallback).not.toBeNull();

    // Advance time to draw frames
    mockTime += 40; // Advance time by > 33.3ms (for 30fps)
    await act(async () => {
      await Promise.resolve(); // Flush microtask queue
      rafCallback(mockTime);
    });

    // Clear rect should be called on frame draw
    expect(mockContext.clearRect).toHaveBeenCalled();
  });

  it('preserves static canvas dimensions during active looping to prevent buffer clearing and flickering', async () => {
    const animationValues = ['frame_one', 'frame_two'];
    const config = {
      ...DEFAULT_CONFIG,
      animationValues,
      isAnimating: true,
      animationFps: 30,
    };

    let container: HTMLElement | null = null;
    await act(async () => {
      const rendered = render(<QRCanvas config={config} size={512} />);
      container = rendered.container;
    });

    const canvas = container!.querySelector('canvas') as HTMLCanvasElement;

    // Wait for the precomputation
    await vi.waitFor(() => {
      expect(QRCode.create).toHaveBeenCalledWith('frame_one', expect.any(Object));
    });

    // Check that the width and height are fixed
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);

    // execute the RAF loop by advancing mockTime
    mockTime += 50;
    await act(async () => {
      await Promise.resolve(); // Flush microtask queue
      rafCallback(mockTime);
    });

    // Canvas width and height should remain perfectly static (unchanged)
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
  });

  it('stops loop cleanly on component unmount and cancels next requestAnimationFrame', async () => {
    const animationValues = ['frame_one'];
    const config = {
      ...DEFAULT_CONFIG,
      animationValues,
      isAnimating: true,
    };

    let unmount: () => void = () => {};
    await act(async () => {
      const rendered = render(<QRCanvas config={config} />);
      unmount = rendered.unmount;
    });

    await vi.waitFor(() => {
      expect(QRCode.create).toHaveBeenCalled();
    });

    expect(window.requestAnimationFrame).toHaveBeenCalled();

    // Unmount should cancel the RAF
    await act(async () => {
      unmount();
    });
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('normalizes URL frames before encoding, like the static canvas and SVG export', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      animationValues: ['example.com/frame-1'],
      isAnimating: true,
      animationFps: 30,
    };

    await act(async () => {
      render(<QRCanvas config={config} />);
    });

    await vi.waitFor(() => {
      expect(QRCode.create).toHaveBeenCalledWith('https://example.com/frame-1', expect.any(Object));
    });
    expect(QRCode.create).not.toHaveBeenCalledWith('example.com/frame-1', expect.any(Object));
  });

  it('encodes non-URL frames verbatim', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      type: QRType.TEXT,
      value: 'plain text',
      animationValues: ['example.com/frame-1'],
      isAnimating: true,
      animationFps: 30,
    };

    await act(async () => {
      render(<QRCanvas config={config} />);
    });

    await vi.waitFor(() => {
      expect(QRCode.create).toHaveBeenCalledWith('example.com/frame-1', expect.any(Object));
    });
  });
});

describe('QRCanvas Border Rendering', () => {
  // The real encoder: these specs render a genuine QR code instead of the fake 21x21 matrix.
  useCanvasEncoder(qrEncoder);

  const mockContext = createMockContext();

  const setupCanvasMock = (originalCreateElement: any) => {
    // Use the original create element to make a real canvas, then mock getContext
    const canvas = originalCreateElement.call(document, 'canvas');
    const context = { ...mockContext, canvas };
    canvas.getContext = vi.fn().mockReturnValue(context);
    return canvas;
  };

  it('renders border when enabled', async () => {
    const originalCreateElement = document.createElement;
    document.createElement = vi.fn((tagName) => {
        if (tagName === 'canvas') return setupCanvasMock(originalCreateElement);
        return originalCreateElement.call(document, tagName);
    }) as any;

    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderSize: 0.1,
      borderColor: '#ff0000',
      bgColor: '#ffffff',
      value: 'test',
    };

    render(<QRCanvas config={config} size={100} />);

    await waitFor(() => {
        expect(mockContext.fillRect).toHaveBeenCalled();
    });

    const fillRectCalls = mockContext.fillRect.mock.calls;

    // Find the call for the border: 0, 0, 100, 100
    const borderCall = fillRectCalls.find(call => call[0] === 0 && call[1] === 0 && call[2] === 100 && call[3] === 100);
    expect(borderCall).toBeTruthy();

    // Find the call for the inner background, quiet zone included: 10, 10, 80, 80
    // (0.1 * 100 = 10px border on each side, with the light quiet zone inside it)
    const innerBgCall = fillRectCalls.find(call => Math.abs(call[0] - 10) < 1e-9 && Math.abs(call[2] - 80) < 1e-9);
    expect(innerBgCall).toBeTruthy();

    document.createElement = originalCreateElement;
  });

  it('does not render border when disabled', async () => {
    const originalCreateElement = document.createElement;
    document.createElement = vi.fn((tagName) => {
        if (tagName === 'canvas') return setupCanvasMock(originalCreateElement);
        return originalCreateElement.call(document, tagName);
    }) as any;

    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: false,
      borderSize: 0.1,
      borderColor: '#ff0000',
    };

    mockContext.fillRect.mockClear();
    render(<QRCanvas config={config} size={100} />);

    await waitFor(() => {
        expect(mockContext.fillRect).toHaveBeenCalled();
    });

    const fillRectCalls = mockContext.fillRect.mock.calls;

    // Should NOT have inner background fill (10, 10, 80, 80)
    const innerBgCall = fillRectCalls.find(call => Math.abs(call[0] - 10) < 1e-9 && Math.abs(call[2] - 80) < 1e-9);
    expect(innerBgCall).toBeUndefined();

    document.createElement = originalCreateElement;
  });
});

describe('QRCanvas Border Extended Features', () => {
  // The real encoder: these specs render a genuine QR code instead of the fake 21x21 matrix.
  useCanvasEncoder(qrEncoder);

  let mockContext: any;
  let createdImages: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createdImages = [];

    mockContext = createMockContext();

    // Spy on getContext to return our mock context
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId === '2d') {
        return mockContext;
      }
      return null;
    });

    stubWindowImage(image => createdImages.push(image));
  });

  
  it('renders dashed border style', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderSize: 0.1,
      borderColor: '#000000',
      borderStyle: 'dashed',
    };

    render(<QRCanvas config={config} size={100} />);

    await waitFor(() => {
      expect(mockContext.setLineDash).toHaveBeenCalled();
      expect(mockContext.strokeRect).toHaveBeenCalled();
    });
  });

  it('renders border text', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderSize: 0.1,
      borderText: 'Scan Me',
      borderTextPosition: 'bottom-center',
    };

    render(<QRCanvas config={config} size={100} />);

    await waitFor(() => {
      expect(mockContext.fillText).toHaveBeenCalledWith('Scan Me', expect.any(Number), expect.any(Number));
    });
  });

  it('renders border logo', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderSize: 0.1,
      borderLogoUrl: 'data:image/png;base64,fake',
    };

    render(<QRCanvas config={config} size={100} />);

    // Wait for image to load and draw
    await waitFor(() => {
      expect(createdImages.length).toBeGreaterThan(0);
    });

    act(() => {
      const img = createdImages[0];
      if (img && img.onload) {
        img.complete = true;
        img.onload();
      }
    });

    await waitFor(() => {
      expect(mockContext.drawImage).toHaveBeenCalled();
    });
  });
});
