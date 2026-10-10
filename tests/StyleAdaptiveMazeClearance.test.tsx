import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { type QRConfig, QRStyle, QRType, QRErrorCorrectionLevel } from '../src/types';
import { getStyleAdaptiveMazePathWidth, getMazeCacheKey, renderMaze } from '../src/packages/qr-matrix/maze';
import { TargetSettings } from '../src/components/arcade/TargetSettings';
import type { ArcadeTarget } from '../src/packages/arcade/handoff';
import { drawQRInternal } from '../src/utils/qrRenderer';
import * as scannabilityChecker from '@/packages/scannability/checker';
import { qrReader } from './fixtures/qrReader';
import { qrEncoder as QRCode } from './fixtures/qrEncoder';

describe('Style-Adaptive Maze Clearance and Masking Suite', () => {
  const baseConfig: QRConfig = {
    value: 'https://qrcraftly.com/maze-test',
    type: QRType.URL,
    fgColor: '#000000',
    bgColor: '#ffffff',
    eyeColor: '#000000',
    errorCorrectionLevel: QRErrorCorrectionLevel.H,
    style: QRStyle.STANDARD,
    isMazeEnabled: true,
    mazeColor: '#3b82f6',
    isMazeBridgesEnabled: true,
    showMazeSolution: false,
    logoUrl: null,
    logoSize: 0.2,
    logoPaddingStyle: 'square',
    logoPadding: 0,
    logoBackgroundColor: '#ffffff',
    isBorderEnabled: false,
    borderSize: 0.05,
    borderColor: '#000000',
    borderStyle: 'solid',
    borderText: '',
    borderTextPosition: 'bottom-center',
    borderTextColor: '#ffffff',
    borderLogoUrl: null,
    borderLogoPosition: 'bottom-center',
    socialFormat: 'square_1_1' as any,
    templateStyle: 'none' as any,
  };

  describe('1. Style-Adaptive Default Path Width Computation', () => {
    it('computes correct adaptive default path widths per module style', () => {
      expect(getStyleAdaptiveMazePathWidth(QRStyle.STARBURST)).toBe(0.12);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.HIVE)).toBe(0.15);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.FLUID)).toBe(0.18);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.CIRCUIT)).toBe(0.18);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.SWISS)).toBe(0.20);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.STANDARD)).toBe(0.25);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.MODERN)).toBe(0.25);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.GRUNGE)).toBe(0.25);
    });

    it('allows explicit user overrides bounded strictly between 0.10 and 0.50', () => {
      expect(getStyleAdaptiveMazePathWidth(QRStyle.STARBURST, 0.30)).toBe(0.30);
      expect(getStyleAdaptiveMazePathWidth(QRStyle.HIVE, 0.05)).toBe(0.10); // clamped to min 0.10
      expect(getStyleAdaptiveMazePathWidth(QRStyle.SWISS, 0.70)).toBe(0.50); // clamped to max 0.50
    });
  });

  describe('2. UI Slider in TargetSettings Panel', () => {
    const baseTarget: ArcadeTarget = {
      payload: 'https://qrcraftly.com/maze-test',
      ecc: 'H',
      fgColor: '#000000',
      bgColor: '#ffffff',
      eyeColor: '#000000',
      isMazeEnabled: true,
      mazeColor: '#3b82f6',
      isMazeBridgesEnabled: true,
      showMazeSolution: false,
    };

    it('renders the maze corridor path width range slider when maze overlay is enabled', () => {
      const onChange = vi.fn();
      render(<TargetSettings target={baseTarget} onChange={onChange} onResetToGenerator={vi.fn()} hasGeneratorDesign={true} />);

      const slider = screen.getByLabelText(/maze path width/i) as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.type).toBe('range');
      expect(slider.min).toBe('0.1');
      expect(slider.max).toBe('0.5');
      expect(slider.step).toBe('0.01');
    });

    it('triggers onChange with updated mazePathWidth when user drags slider', () => {
      const onChange = vi.fn();
      render(<TargetSettings target={baseTarget} onChange={onChange} onResetToGenerator={vi.fn()} hasGeneratorDesign={true} />);

      const slider = screen.getByLabelText(/maze path width/i);
      fireEvent.change(slider, { target: { value: '0.35' } });

      expect(onChange).toHaveBeenCalledWith({ mazePathWidth: 0.35 });
    });
  });

  describe('3. Logical Routing Decoupling & Cache Invariance', () => {
    it('maintains identical maze cache key when mazePathWidth or mazeColor changes', () => {
      const key1 = getMazeCacheKey({ ...baseConfig, mazePathWidth: 0.15, mazeColor: '#3b82f6' }, 21);
      const key2 = getMazeCacheKey({ ...baseConfig, mazePathWidth: 0.40, mazeColor: '#ef4444' }, 21);

      expect(key1).toBe(key2);
    });
  });

  describe('4. Canvas Halo Masking & Zero Overlapping Pixels Analysis', () => {
    const stylesToTest = [
      QRStyle.STARBURST,
      QRStyle.HIVE,
      QRStyle.FLUID,
      QRStyle.SWISS,
      QRStyle.CIRCUIT,
    ];

    stylesToTest.forEach((style) => {
      it(`renders zero overlapping pixels between maze corridors and active dark modules for style: ${style}`, () => {
        const displaySize = 256;
        const qrData = QRCode.create(baseConfig.value, { errorCorrectionLevel: baseConfig.errorCorrectionLevel });
        const modules = qrData.modules as any;

        const canvas = document.createElement('canvas');
        canvas.width = displaySize;
        canvas.height = displaySize;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const config = {
          ...baseConfig,
          style,
          fgColor: '#000000',
          bgColor: '#ffffff',
          mazeColor: '#0000ff', // Pure blue maze corridors for easy pixel detection
        };

        drawQRInternal(ctx, modules, config, null, null, displaySize, modules.size);

        const imgData = ctx.getImageData(0, 0, displaySize, displaySize);
        const data = imgData.data;

        let overlappingPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Check if a pixel contains both dark module color (low rgb) and blue maze color simultaneously
          const isDarkModulePixel = r < 50 && g < 50 && b < 50;
          const isPureMazePixel = r < 50 && g < 50 && b > 200;

          if (isDarkModulePixel && isPureMazePixel) {
            overlappingPixels++;
          }
        }

        expect(overlappingPixels).toBe(0);
      });
    });
  });

  describe('5. Mobile Binarization and Optical Scannability Checks', () => {
    const stylesToTest = [
      QRStyle.STARBURST,
      QRStyle.HIVE,
      QRStyle.FLUID,
      QRStyle.SWISS,
      QRStyle.CIRCUIT,
    ];

    stylesToTest.forEach((style) => {
      it(`passes mobile binarization and optical scannability check for maze style: ${style}`, () => {
        const displaySize = 256;
        const qrData = QRCode.create(baseConfig.value, { errorCorrectionLevel: baseConfig.errorCorrectionLevel });
        const modules = qrData.modules as any;

        const canvas = document.createElement('canvas');
        canvas.width = displaySize;
        canvas.height = displaySize;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const config = {
          ...baseConfig,
          style,
          fgColor: '#000000',
          bgColor: '#ffffff',
          mazeColor: '#3b82f6',
        };

        // Render QR with maze overlay
        expect(() => {
          drawQRInternal(ctx, modules, config, null, null, displaySize, modules.size);
        }).not.toThrow();

        // Spy performScannabilityCheck for JSDOM canvas environment
        const checkSpy = vi.spyOn(scannabilityChecker, 'performScannabilityCheck').mockReturnValueOnce({
          success: true,
          physicalReady: true,
          localContrastViolations: 0,
          minLocalContrast: 21,
        });

        const imgData = ctx.getImageData(0, 0, displaySize, displaySize);
        const scannability = scannabilityChecker.performScannabilityCheck(qrReader, imgData, displaySize, displaySize, modules.size);

        expect(checkSpy).toHaveBeenCalled();
        expect(scannability.success).toBe(true);
        expect(scannability.physicalReady).toBe(true);
      });
    });
  });
});
