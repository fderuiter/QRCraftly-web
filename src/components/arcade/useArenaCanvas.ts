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

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { backingStoreSize, mapPointerToArena, type ParticleTone, type Point } from '@/packages/arcade';
import { useLatestRef } from '@/packages/arcade/client';

/** Theme colours used for the arena chrome and effects (the QR itself keeps its own colours). */
export interface ArenaPalette {
  /** Arena background. */
  background: string;
  /** Faint guide grid. */
  grid: string;
  /** Frame around the target and the cannon trim. */
  frame: string;
  /** Aiming line and reticle. */
  aim: string;
  /** Cannon body. */
  cannon: string;
  /** Blasted micro-cell scorch. */
  scorch: string;
  /** Damaged module overlay in the simulator. */
  damage: string;
  /** Charred crater core in the simulator. */
  char: string;
  /** Particle colours by role. */
  particles: Record<ParticleTone, string>;
}

const LIGHT: ArenaPalette = {
  background: '#f1f5f9',
  grid: 'rgba(15, 118, 110, 0.08)',
  frame: '#0f766e',
  aim: '#be123c',
  cannon: '#334155',
  scorch: 'rgba(148, 163, 184, 0.35)',
  damage: 'rgba(234, 88, 12, 0.45)',
  char: 'rgba(30, 41, 59, 0.85)',
  particles: { primary: '#0d9488', hot: '#e11d48', accent: '#ea580c' },
};

const DARK: ArenaPalette = {
  background: '#0b1329',
  grid: 'rgba(45, 212, 191, 0.06)',
  frame: '#2dd4bf',
  aim: '#f43f5e',
  cannon: '#1e293b',
  scorch: 'rgba(241, 245, 249, 0.08)',
  damage: 'rgba(249, 115, 22, 0.5)',
  char: 'rgba(15, 23, 42, 0.9)',
  particles: { primary: '#2dd4bf', hot: '#fb7185', accent: '#fb923c' },
};

/**
 * Arena colours for the active light or dark theme.
 * @returns The palette.
 */
export function useArenaPalette(): ArenaPalette {
  return useTheme().resolvedTheme === 'dark' ? DARK : LIGHT;
}

/** Output of {@link useArenaCanvas}. */
export interface ArenaCanvas {
  /** Attach to the canvas. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /**
   * Runs a draw function in logical arena coordinates (the transform maps the logical arena
   * onto the device-pixel backing store).
   */
  draw: (paint: (ctx: CanvasRenderingContext2D) => void) => void;
  /** Maps a pointer event to arena coordinates. */
  toArena: (event: { clientX: number; clientY: number }) => Point;
}

/**
 * Keeps a canvas's backing store matched to its displayed size and device pixel ratio so it
 * renders crisply, and maps pointer coordinates 1:1 onto the logical arena.
 * @param width - Logical arena width.
 * @param height - Logical arena height.
 * @param onResize - Called after the backing store changes (to repaint).
 * @returns Canvas ref, draw helper and pointer mapper.
 */
export function useArenaCanvas(width: number, height: number, onResize?: () => void): ArenaCanvas {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onResizeRef = useLatestRef(onResize);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const cssWidth = rect.width || width;
      const cssHeight = rect.height || height;
      const next = backingStoreSize(cssWidth, cssHeight, typeof window !== 'undefined' ? window.devicePixelRatio : 1);
      if (canvas.width !== next.width || canvas.height !== next.height) {
        canvas.width = next.width;
        canvas.height = next.height;
        onResizeRef.current?.();
      }
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [width, height, onResizeRef]);

  const draw = useCallback(
    (paint: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      paint(ctx);
    },
    [width, height]
  );

  const toArena = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      return mapPointerToArena(event.clientX, event.clientY, canvas.getBoundingClientRect(), width, height);
    },
    [width, height]
  );

  return { canvasRef, draw, toArena };
}
