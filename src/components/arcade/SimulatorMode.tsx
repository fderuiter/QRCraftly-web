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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  analyzeDamage,
  applyBlast,
  BARRAGE_STRIKES,
  buildTargetMatrix,
  finderAt,
  isDarkModule,
  paintScanFrame,
  planBarrage,
  SCAN_FRAME_SIZE,
  SIMULATOR_WEAPONS,
  SimulatorWeaponId,
  TargetMatrix,
} from '@/packages/arcade';
import { useEmpiricalScan, useLatestRef, useReducedMotion } from '@/packages/arcade/client';
import type { ArcadeTarget } from '@/packages/arcade/handoff';
import type { QrEncoder } from '@/packages/qr-matrix';
import { ArcadeCockpit } from './ArcadeCockpit';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { DefeatModal } from './DefeatModal';
import { ScanHud } from './ScanHud';
import { ArenaPalette, useArenaCanvas, useArenaPalette } from './useArenaCanvas';
import { Announce, useArcadeStatus } from './useArcadeStatus';
import { useScanFrameCapture } from './useScanFrameCapture';

/** Logical side of the simulator board. */
const BOARD = 512;

/** A fading shockwave ring (visual only). */
interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
}

/** Properties shared by both modes. */
export interface ModeProps {
  /** Target under test. */
  target: ArcadeTarget;
  /** The QR encoder that builds the target's matrix. */
  encoder: QrEncoder;
  /** Target settings panel. */
  settings: React.ReactNode;
  /** Screen-reader announcements. */
  announce: Announce;
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  matrix: TargetMatrix,
  damage: ReadonlySet<number>,
  target: ArcadeTarget,
  palette: ArenaPalette,
  rings: readonly Ring[],
  cursor: { row: number; col: number } | null
) {
  const { size } = matrix;
  const cell = BOARD / size;
  ctx.fillStyle = target.bgColor;
  ctx.fillRect(0, 0, BOARD, BOARD);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const index = r * size + c;
      const dark = isDarkModule(matrix, r, c);
      if (damage.has(index)) {
        // A damaged module reads as the wrong colour: dark modules scorch light, light ones char.
        ctx.fillStyle = palette.damage;
        ctx.fillRect(c * cell, r * cell, cell, cell);
        if (!dark) {
          ctx.fillStyle = palette.char;
          ctx.fillRect(c * cell + cell * 0.15, r * cell + cell * 0.15, cell * 0.7, cell * 0.7);
        }
      } else if (dark) {
        ctx.fillStyle = finderAt(r, c, size) ? target.eyeColor : target.fgColor;
        ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
      }
    }
  }
  for (const ring of rings) {
    ctx.globalAlpha = Math.max(0, ring.life);
    ctx.strokeStyle = palette.particles.hot;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius * (1.4 - ring.life * 0.4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (cursor) {
    ctx.strokeStyle = palette.aim;
    ctx.lineWidth = 2;
    ctx.strokeRect(cursor.col * cell + 1, cursor.row * cell + 1, cell - 2, cell - 2);
  }
}

/**
 * Damage Simulator: precision strikes on modules with four blast radii, artillery barrages,
 * interleaved Reed-Solomon analytics, finder monitoring and a defeat diagnostic.
 * @param props - Mode properties.
 * @returns The simulator.
 */
export function SimulatorMode({ target, encoder, settings, announce }: ModeProps) {
  const matrix = useMemo(() => buildTargetMatrix(target.payload, target.ecc, encoder), [target.payload, target.ecc, encoder]);
  const [damage, setDamage] = useState<ReadonlySet<number>>(() => new Set());
  const [weaponId, setWeaponId] = useState<SimulatorWeaponId>('pinpoint');
  const [latency, setLatency] = useState(0);
  const [rebuilds, setRebuilds] = useState(0);
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);
  const palette = useArenaPalette();
  const reducedMotion = useReducedMotion();
  const drawingRef = useRef(false);
  const lastCellRef = useRef(-1);
  const ringsRef = useRef<Ring[]>([]);
  const frameRef = useRef<number | null>(null);
  // Mirrors the committed damage; strikes also write it eagerly so a drag's strikes compose.
  const damageRef = useRef(damage);
  useEffect(() => {
    damageRef.current = damage;
  }, [damage]);

  const weapon = SIMULATOR_WEAPONS.find((w) => w.id === weaponId) ?? SIMULATOR_WEAPONS[0];
  const analysis = useMemo(() => analyzeDamage(damage, matrix.size, matrix.ecc), [damage, matrix]);

  const capture = useScanFrameCapture((ctx) =>
    paintScanFrame(ctx, SCAN_FRAME_SIZE, matrix.size, 4, (r, c) => isDarkModule(matrix, r, c) !== damageRef.current.has(r * matrix.size + c), {
      fg: target.fgColor,
      bg: target.bgColor,
    })
  );
  const scan = useEmpiricalScan({
    captureFrame: capture,
    expectedPayload: () => matrix.payload,
    isInputActive: () => drawingRef.current,
    boardKey: `${matrix.payload}|${matrix.ecc}|${target.fgColor}|${target.bgColor}|${rebuilds}`,
  });
  const { defeatOpen, closeDefeat } = useArcadeStatus(analysis, scan.state, announce);
  const requestScan = scan.request;

  const scene = useLatestRef({ matrix, target, palette, cursor });
  const redraw = useCallback(() => {
    const s = scene.current;
    drawRef.current((ctx) => drawBoard(ctx, s.matrix, damageRef.current, s.target, s.palette, ringsRef.current, s.cursor));
    // `scene` and `drawRef` are stable refs; `drawRef` is declared below because useArenaCanvas
    // needs `redraw` first, so listing it here would read it before initialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { canvasRef, draw, toArena } = useArenaCanvas(BOARD, BOARD, redraw);
  const drawRef = useLatestRef(draw);

  useEffect(() => {
    redraw();
  }, [damage, matrix, target, palette, cursor, redraw]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const animateRings = useCallback(() => {
    if (frameRef.current !== null) return;
    const step = () => {
      ringsRef.current = ringsRef.current.map((ring) => ({ ...ring, life: ring.life - 0.06 })).filter((ring) => ring.life > 0);
      redraw();
      frameRef.current = ringsRef.current.length > 0 ? requestAnimationFrame(step) : null;
    };
    frameRef.current = requestAnimationFrame(step);
  }, [redraw]);

  const rebuild = useCallback(() => {
    setDamage(new Set());
    ringsRef.current = [];
    setRebuilds((n) => n + 1);
    closeDefeat();
  }, [closeDefeat]);

  useEffect(() => {
    setDamage(new Set());
    ringsRef.current = [];
  }, [matrix]);

  const strikeCells = useCallback(
    (strikes: readonly { row: number; col: number; radius: number }[]) => {
      const start = performance.now();
      let next: ReadonlySet<number> = damageRef.current;
      const cell = BOARD / matrix.size;
      for (const strike of strikes) {
        next = applyBlast(next, matrix.size, strike.row, strike.col, strike.radius);
        if (!reducedMotion) {
          ringsRef.current.push({ x: (strike.col + 0.5) * cell, y: (strike.row + 0.5) * cell, radius: (strike.radius + 0.5) * cell, life: 1 });
        }
      }
      damageRef.current = next;
      setDamage(next);
      setLatency(Number(((performance.now() - start) / Math.max(1, strikes.length)).toFixed(2)));
      if (!reducedMotion) animateRings();
      requestScan();
    },
    [matrix.size, reducedMotion, animateRings, requestScan]
  );

  const strikeAt = (event: { clientX: number; clientY: number }) => {
    const point = toArena(event);
    const row = Math.min(matrix.size - 1, Math.floor((point.y / BOARD) * matrix.size));
    const col = Math.min(matrix.size - 1, Math.floor((point.x / BOARD) * matrix.size));
    const cellIndex = row * matrix.size + col;
    if (drawingRef.current && cellIndex === lastCellRef.current) return;
    lastCellRef.current = cellIndex;
    strikeCells([{ row, col, radius: weapon.radius }]);
  };

  const stopDrawing = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastCellRef.current = -1;
    scan.settle();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const current = cursor ?? { row: Math.floor(matrix.size / 2), col: Math.floor(matrix.size / 2) };
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCursor({
        row: Math.max(0, Math.min(matrix.size - 1, current.row + move[0])),
        col: Math.max(0, Math.min(matrix.size - 1, current.col + move[1])),
      });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setCursor(current);
      strikeCells([{ row: current.row, col: current.col, radius: weapon.radius }]);
    }
  };

  const barrage = () => {
    strikeCells(planBarrage(matrix.size, BARRAGE_STRIKES, SIMULATOR_WEAPONS.map((w) => w.radius)));
    announce(`Artillery barrage: ${BARRAGE_STRIKES} strikes landed.`);
  };

  const selectWeapon = (id: SimulatorWeaponId) => {
    setWeaponId(id);
    const chosen = SIMULATOR_WEAPONS.find((w) => w.id === id);
    if (chosen) announce(`${chosen.name} selected, ${chosen.area} blast.`);
  };

  const weaponChoices = SIMULATOR_WEAPONS.map((w) => ({ value: w.id, label: w.name }));

  return (
    <>
      <ArcadeCockpit
        settings={settings}
        arsenal={
          <Card variant="control" className="space-y-3">
            <h2 className="text-sm font-bold text-fg">Blast weapon</h2>
            <SegmentedControl<SimulatorWeaponId>
              appearance="tiles"
              label="Blast weapon"
              className="grid-cols-1"
              options={SIMULATOR_WEAPONS.map((w) => ({
                value: w.id,
                label: (
                  <span className="flex w-full flex-col items-start text-left">
                    <span className="font-bold">{w.name} <span className="font-normal">({w.area})</span></span>
                    <span className="text-xs font-normal">{w.description}</span>
                  </span>
                ),
                ariaLabel: `${w.name}, ${w.area}`,
              }))}
              value={weaponId}
              onChange={selectWeapon}
            />
          </Card>
        }
        arena={
          <div className="mx-auto w-full max-w-[min(100%,32rem)] rounded-2xl border-2 border-line bg-surface p-2">
            <canvas
              ref={canvasRef}
              width={BOARD}
              height={BOARD}
              tabIndex={0}
              role="img"
              aria-label={`Damage simulator board, ${matrix.size} by ${matrix.size} modules. Click or drag to strike with the ${weapon.name}; with the keyboard, move with the arrow keys and strike with Enter or Space.`}
              className="block aspect-square w-full cursor-crosshair rounded-lg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              style={{ touchAction: 'none' }}
              data-testid="arcade-simulator-canvas"
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Pointer capture is best-effort.
                }
                drawingRef.current = true;
                lastCellRef.current = -1;
                strikeAt(event);
              }}
              onPointerMove={(event) => {
                if (drawingRef.current) strikeAt(event);
              }}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              onLostPointerCapture={stopDrawing}
              onKeyDown={handleKeyDown}
              onBlur={() => setCursor(null)}
            />
          </div>
        }
        quickBar={
          <SegmentedControl<SimulatorWeaponId>
            appearance="tiles"
            label="Weapon"
            className="grid-cols-2 sm:grid-cols-4"
            options={weaponChoices}
            value={weaponId}
            onChange={selectWeapon}
          />
        }
        hints={
          <p className="text-center text-xs text-fg-muted">
            Click or drag to strike. Keyboard: focus the board, move with the arrow keys, strike with Enter or Space.
          </p>
        }
        hud={<ScanHud analysis={analysis} empirical={scan.state} isNative={scan.isNative} />}
        actions={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={rebuild} disabled={damage.size === 0}>
              <Trash2 className="size-4" aria-hidden="true" />
              Reset Grid
            </Button>
            <Button variant="primary" onClick={barrage}>
              <Play className="size-4" aria-hidden="true" />
              Artillery Barrage
            </Button>
          </div>
        }
        telemetry={
          <Card variant="control">
            <h2 className="mb-3 text-sm font-bold text-fg">Telemetry</h2>
            <dl className="grid grid-cols-2 gap-3 text-xs text-fg-muted">
              <div><dt>QR grid</dt><dd className="font-bold text-fg">{matrix.size} × {matrix.size}</dd></div>
              <div><dt>Total modules</dt><dd className="font-bold text-fg">{analysis.totalModules}</dd></div>
              <div><dt>Damage budget</dt><dd className="font-bold text-fg">{analysis.budget} modules</dd></div>
              <div><dt>Destroyed</dt><dd className="font-bold text-fg">{analysis.damagedCount} modules</dd></div>
              <div><dt>Block damage</dt><dd className="font-bold text-fg">{analysis.blockDamage.join(' · ')}</dd></div>
              <div><dt>Blast maths</dt><dd className="font-bold text-fg">{latency} ms</dd></div>
            </dl>
          </Card>
        }
      />
      <DefeatModal isOpen={defeatOpen} analysis={analysis} onRebuild={rebuild} onClose={closeDefeat} />
    </>
  );
}
