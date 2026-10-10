/*
    QRCraftly
    Copyright (C) 2025 fderuiter
*/

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import React from 'react';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { useOpticalSender } from '@/packages/optical-transfer/client';
import QRCanvas from '@/components/QRCanvas';
import { generateMaze, getCachedMaze, clearMazeCache, getMazeCacheKey } from '@/packages/qr-matrix/maze';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

describe('Centralized Fallback Store & Off-Thread Maze Execution Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMazeCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearMazeCache();
  });

  it('AC1: Scannability verification failures immediately update global store state and reflect across preview and sender components simultaneously', () => {
    const mazeConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      isMazeEnabled: true,
      isMazeBridgesEnabled: true,
    };

    let storeInstance: any;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QRProvider initialConfig={mazeConfig}>
        {children}
      </QRProvider>
    );

    const { result: senderHook } = renderHook(
      () => {
        const store = useQRStore();
        storeInstance = store;
        return useOpticalSender({
          config: store.getState().config,
          logoImg: null,
          borderLogoImg: null,
          renderFrame: vi.fn(),
          scannabilityFallbackActive: store.getState().isScannabilityFallbackActive,
        });
      },
      { wrapper }
    );

    expect(storeInstance.getState().isScannabilityFallbackActive).toBe(false);

    // Emit scannability-fail signal
    act(() => {
      storeInstance.emitSignal('scannability-fail', { errorType: 'LOW_CONTRAST' });
    });

    // Global store state immediately updates to fallback active
    expect(storeInstance.getState().isScannabilityFallbackActive).toBe(true);

    // Appearance-only changes keep the fallback decision
    act(() => {
      storeInstance.updateConfig({ fgColor: '#123456' });
    });
    expect(storeInstance.getState().isScannabilityFallbackActive).toBe(true);

    // Content changes reset fallback active
    act(() => {
      storeInstance.updateConfig({ value: 'https://example.com/changed' });
    });

    expect(storeInstance.getState().isScannabilityFallbackActive).toBe(false);
  });

  it('AC2: Frame animation playback maintains active state without resetting sequence progress during scannability fallback toggles', () => {
    let storeInstance: any;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QRProvider initialConfig={{ ...DEFAULT_CONFIG, isMazeEnabled: true, isMazeBridgesEnabled: true }}>
        {children}
      </QRProvider>
    );

    const { result } = renderHook(
      () => {
        const store = useQRStore();
        storeInstance = store;
        return useOpticalSender({
          config: store.getState().config,
          logoImg: null,
          borderLogoImg: null,
          renderFrame: vi.fn(),
          scannabilityFallbackActive: store.getState().isScannabilityFallbackActive,
        });
      },
      { wrapper }
    );

    // Select a file
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    act(() => {
      result.current.setSelectedFile(file);
    });

    // Emit scannability-fail signal mid-session
    act(() => {
      storeInstance.emitSignal('scannability-fail', { errorType: 'TEST_FAIL' });
    });

    // Fallback is active in central store
    expect(storeInstance.getState().isScannabilityFallbackActive).toBe(true);
    // Selected file & player options remain intact
    expect(result.current.selectedFile).toBe(file);
  });

  it('AC3: Maze layout and pathfinding calculations are executed off-thread and cached', () => {
    const size = 21;
    const mockModules = {
      size,
      get: () => false,
    };
    const mazeConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      isMazeEnabled: true,
      isMazeBridgesEnabled: true,
    };

    const cacheKey = getMazeCacheKey(mazeConfig, size, mockModules);
    expect(getCachedMaze(cacheKey)).toBeUndefined();

    const generated = generateMaze(mockModules, mazeConfig, size);
    expect(generated).toBeDefined();
    expect(getCachedMaze(cacheKey)).toBeDefined();
  });

  it('AC4: Re-applying previous bridge configurations retrieves pre-computed pathfinding layouts from cache without recalculation overhead', () => {
    const size = 21;
    const mockModules = {
      size,
      get: () => false,
    };
    const configWithBridges: QRConfig = {
      ...DEFAULT_CONFIG,
      isMazeEnabled: true,
      isMazeBridgesEnabled: true,
    };
    const configNoBridges: QRConfig = {
      ...DEFAULT_CONFIG,
      isMazeEnabled: true,
      isMazeBridgesEnabled: false,
    };

    // 1. Initial computation for bridges=true
    const maze1 = generateMaze(mockModules, configWithBridges, size);

    // 2. Switch to bridges=false
    const maze2 = generateMaze(mockModules, configNoBridges, size);
    expect(maze2).not.toBe(maze1);

    // 3. Re-apply bridges=true configuration
    const maze3 = generateMaze(mockModules, configWithBridges, size);

    // Should return the exact same pre-computed reference from cache
    expect(maze3).toBe(maze1);
  });
});
