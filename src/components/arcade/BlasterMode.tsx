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
import { HeartPulse } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  addParticles,
  addShake,
  aimAngle,
  analyzeDamage,
  BLASTER_ARENA,
  BLASTER_WEAPONS,
  BlasterWeaponId,
  blasterWeaponForKey,
  blankTargetMatrix,
  buildTargetMatrix,
  burnLaser,
  burst,
  decayShake,
  finderAt,
  healthTone,
  Impact,
  MAX_ROCKETS_IN_FLIGHT,
  MicroGrid,
  paintScanFrame,
  Particle,
  Point,
  Projectile,
  ProjectileKind,
  SCAN_FRAME_SIZE,
  spawnProjectile,
  stepParticles,
  stepProjectiles,
} from '@/packages/arcade';
import { useEmpiricalScan, useLatestRef, useReducedMotion } from '@/packages/arcade/client';
import type { ArcadeTarget } from '@/packages/arcade/handoff';
import { ArcadeCockpit } from './ArcadeCockpit';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { DefeatModal } from './DefeatModal';
import { ScanHud } from './ScanHud';
import type { ModeProps } from './SimulatorMode';
import { ArenaPalette, useArenaCanvas, useArenaPalette } from './useArenaCanvas';
import { useArcadeStatus } from './useArcadeStatus';
import { useScanFrameCapture } from './useScanFrameCapture';

const A = BLASTER_ARENA;

/** Durability statistics shown in the HUD. */
interface Durability {
  intact: number;
  original: number;
  destroyed: number;
  percent: number;
}

function readDurability(grid: MicroGrid): Durability {
  return { intact: grid.intactDark, original: grid.originalDark, destroyed: grid.destroyed, percent: grid.durabilityPercent };
}

/**
 * Whether a keyboard event comes from a control that handles its own keys.
 * @param target - Event target.
 * @returns True for text fields and other interactive controls.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.getAttribute('role') === 'radio' || target.getAttribute('role') === 'tab';
}

interface Scene {
  grid: MicroGrid;
  target: ArcadeTarget;
  palette: ArenaPalette;
  aim: Point;
  weapon: BlasterWeaponId;
  laserOn: boolean;
  projectiles: readonly Projectile[];
  particles: readonly Particle[];
  shake: number;
  tick: number;
}

function drawScene(ctx: CanvasRenderingContext2D, s: Scene) {
  const { grid, target, palette } = s;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, A.width, A.height);
  ctx.save();
  if (s.shake > 0) ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= A.width; x += 40) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, A.height);
  }
  for (let y = 0; y <= A.height; y += 40) {
    ctx.moveTo(0, y);
    ctx.lineTo(A.width, y);
  }
  ctx.stroke();

  // Target plate in the design's own background colour, then the micro-grid.
  ctx.fillStyle = target.bgColor;
  ctx.fillRect(A.qrX - 12, A.qrY - 12, A.qrSize + 24, A.qrSize + 24);
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = 2;
  ctx.strokeRect(A.qrX - 12, A.qrY - 12, A.qrSize + 24, A.qrSize + 24);

  const macroPx = A.qrSize / grid.macroSize;
  const microPx = A.qrSize / grid.size;
  for (let r = 0; r < grid.macroSize; r++) {
    for (let c = 0; c < grid.macroSize; c++) {
      if (!grid.wasDark(r * grid.subdivision, c * grid.subdivision)) continue;
      const colour = finderAt(r, c, grid.macroSize) ? target.eyeColor : target.fgColor;
      if (grid.destroyedInModule(r, c) === 0) {
        ctx.fillStyle = colour;
        ctx.fillRect(A.qrX + c * macroPx, A.qrY + r * macroPx, macroPx + 0.5, macroPx + 0.5);
        continue;
      }
      for (let mr = r * grid.subdivision; mr < (r + 1) * grid.subdivision; mr++) {
        for (let mc = c * grid.subdivision; mc < (c + 1) * grid.subdivision; mc++) {
          ctx.fillStyle = grid.isIntact(mr, mc) ? colour : palette.scorch;
          ctx.fillRect(A.qrX + mc * microPx, A.qrY + mr * microPx, microPx + 0.3, microPx + 0.3);
        }
      }
    }
  }

  if (s.laserOn) {
    ctx.strokeStyle = palette.particles.primary;
    ctx.lineWidth = 6 + Math.sin(s.tick * 0.4) * 2;
    ctx.beginPath();
    ctx.moveTo(A.cannonX, A.cannonY);
    ctx.lineTo(s.aim.x, s.aim.y);
    ctx.stroke();
  } else {
    ctx.strokeStyle = palette.aim;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(A.cannonX, A.cannonY);
    ctx.lineTo(s.aim.x, s.aim.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const p of s.projectiles) {
    ctx.fillStyle = p.kind === 'rocket' ? palette.particles.hot : palette.particles.primary;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const pt of s.particles) {
    ctx.globalAlpha = Math.max(0, pt.alpha);
    ctx.fillStyle = palette.particles[pt.tone];
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Reticle
  ctx.strokeStyle = palette.aim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.aim.x, s.aim.y, 12, 0, Math.PI * 2);
  ctx.stroke();

  // Swivelling cannon
  ctx.save();
  ctx.translate(A.cannonX, A.cannonY);
  ctx.rotate(aimAngle(A, s.aim));
  ctx.fillStyle = palette.cannon;
  ctx.fillRect(-5, -8, 42, 16);
  ctx.strokeStyle = s.weapon === 'rocket' ? palette.particles.hot : palette.frame;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-5, -8, 42, 16);
  ctx.restore();
  ctx.fillStyle = palette.cannon;
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(A.cannonX, A.cannonY + 12, 25, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * Arcade Blaster: a cannon that tracks the pointer and chips a 4x4 micro-cell grid with
 * plasma bolts, a thermal laser and antimatter rockets, with particles and screen shake
 * (both disabled under reduced motion).
 * @param props - Mode properties.
 * @returns The blaster.
 */
export function BlasterMode({ target, encoder, settings, announce }: ModeProps) {
  const matrix = useMemo(
    () => (encoder ? buildTargetMatrix(target.payload, target.ecc, encoder) : blankTargetMatrix(target.payload, target.ecc)),
    [target.payload, target.ecc, encoder]
  );
  const grid = useMemo(() => new MicroGrid(matrix), [matrix]);
  const [weapon, setWeapon] = useState<BlasterWeaponId>('plasma');
  const [autoFire, setAutoFire] = useState(false);
  const [durability, setDurability] = useState<Durability>(() => readDurability(grid));
  const [macroDamage, setMacroDamage] = useState<number[]>([]);
  const [heals, setHeals] = useState(0);
  const palette = useArenaPalette();
  const reducedMotion = useReducedMotion();

  const aimRef = useRef<Point>({ x: A.cannonX, y: A.qrY + A.qrSize / 2 });
  const pointerDownRef = useRef(false);
  const spaceHeldRef = useRef(false);
  const projectilesRef = useRef<Projectile[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef(0);
  const tickRef = useRef(0);
  const live = useLatestRef({ weapon, autoFire, reducedMotion, palette, target, grid });

  const analysis = useMemo(() => analyzeDamage(macroDamage, matrix.size, matrix.ecc), [macroDamage, matrix]);

  const capture = useScanFrameCapture((ctx) =>
    paintScanFrame(ctx, SCAN_FRAME_SIZE, grid.size, 4 * grid.subdivision, (r, c) => grid.isIntact(r, c), {
      fg: target.fgColor,
      bg: target.bgColor,
    })
  );
  const scan = useEmpiricalScan({
    captureFrame: capture,
    expectedPayload: () => matrix.payload,
    isInputActive: () => pointerDownRef.current || spaceHeldRef.current || live.current.autoFire,
    boardKey: `${matrix.payload}|${matrix.ecc}|${target.fgColor}|${target.bgColor}|${heals}|${encoder ? 'ready' : 'blank'}`,
  });
  const { defeatOpen, closeDefeat } = useArcadeStatus(analysis, scan.state, announce);
  const scanRef = useLatestRef(scan);

  const { canvasRef, draw, toArena } = useArenaCanvas(A.width, A.height);

  const syncStats = useCallback(() => {
    const g = live.current.grid;
    setDurability(readDurability(g));
    setMacroDamage(g.macroDamage());
  }, [live]);

  useEffect(() => {
    projectilesRef.current = [];
    particlesRef.current = [];
    syncStats();
  }, [grid, syncStats]);

  const fire = useCallback((kind: ProjectileKind) => {
    if (kind === 'rocket' && projectilesRef.current.filter((p) => p.kind === 'rocket').length >= MAX_ROCKETS_IN_FLIGHT) return;
    const projectile = spawnProjectile(kind, A, aimRef.current);
    if (!projectile) return;
    projectilesRef.current.push(projectile);
    shakeRef.current = addShake(shakeRef.current, kind, live.current.reducedMotion);
  }, [live]);

  const trigger = useCallback(() => {
    const current = live.current.weapon;
    if (current !== 'laser') fire(current);
  }, [fire, live]);

  const handleImpacts = useCallback((impacts: Impact[]) => {
    if (impacts.length === 0) return;
    const { reducedMotion: calm } = live.current;
    for (const impact of impacts) {
      if (!calm) {
        const origin = { x: impact.x, y: impact.y };
        if (impact.kind === 'rocket') {
          addParticles(particlesRef.current, burst(origin, 40, { speed: 12, tone: 'hot', gravity: false, size: 3 }));
          addParticles(particlesRef.current, burst(origin, 20, { speed: 9, tone: 'accent', gravity: true, size: 3 }));
        } else {
          addParticles(particlesRef.current, burst(origin, impact.kind === 'laser' ? 3 : 6, { speed: 8, tone: 'primary', gravity: true }));
        }
      }
      const event = impact.kind === 'rocket' ? 'rocketHit' : impact.kind === 'laser' ? 'laser' : 'plasmaHit';
      shakeRef.current = addShake(shakeRef.current, event, calm);
    }
    syncStats();
    scanRef.current.request();
  }, [live, scanRef, syncStats]);

  // Main loop: physics, damage and rendering run on refs so React does not re-render per frame.
  useEffect(() => {
    let frame: number | null = null;
    const loop = () => {
      const state = live.current;
      tickRef.current++;
      const laserOn = state.weapon === 'laser' && (pointerDownRef.current || spaceHeldRef.current);
      const impacts: Impact[] = [];
      if (laserOn) {
        const burn = burnLaser(state.grid, A, aimRef.current);
        if (burn) impacts.push(burn);
      }
      if (state.autoFire && state.weapon === 'plasma' && tickRef.current % 5 === 0) fire('plasma');
      impacts.push(...stepProjectiles(projectilesRef.current, state.grid, A));
      handleImpacts(impacts);
      if (state.reducedMotion) particlesRef.current.length = 0;
      else if (tickRef.current % 2 === 0) {
        for (const p of projectilesRef.current) {
          addParticles(particlesRef.current, burst({ x: p.x, y: p.y }, 1, { speed: 2, tone: p.kind === 'rocket' ? 'hot' : 'primary', gravity: false, size: 1.5, drift: { x: -p.vx * 0.2, y: -p.vy * 0.2 } }));
        }
      }
      stepParticles(particlesRef.current);
      shakeRef.current = decayShake(shakeRef.current);
      draw((ctx) =>
        drawScene(ctx, {
          grid: state.grid,
          target: state.target,
          palette: state.palette,
          aim: aimRef.current,
          weapon: state.weapon,
          laserOn,
          projectiles: projectilesRef.current,
          particles: particlesRef.current,
          shake: shakeRef.current,
          tick: tickRef.current,
        })
      );
      if (!pointerDownRef.current && !spaceHeldRef.current && !state.autoFire) scanRef.current.settle();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [draw, fire, handleImpacts, live, scanRef]);

  const selectWeapon = useCallback(
    (id: BlasterWeaponId) => {
      setWeapon(id);
      const chosen = BLASTER_WEAPONS.find((w) => w.id === id);
      if (chosen) announce(`${chosen.name} equipped.`);
    },
    [announce]
  );

  // Keyboard: 1/2/3 switch weapons, Space fires (or holds the laser). Ignored while typing,
  // on other controls, with modifiers, or while a dialog is open.
  useEffect(() => {
    const blocked = (event: KeyboardEvent) =>
      event.altKey || event.ctrlKey || event.metaKey || isInteractiveTarget(event.target) || document.querySelector('[aria-modal="true"]') !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked(event)) return;
      const next = blasterWeaponForKey(event.key);
      if (next) {
        selectWeapon(next);
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        if (live.current.weapon === 'laser') spaceHeldRef.current = true;
        else trigger();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        spaceHeldRef.current = false;
        scanRef.current.settle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [live, scanRef, selectWeapon, trigger]);

  const heal = useCallback(() => {
    grid.heal();
    projectilesRef.current = [];
    syncStats();
    setHeals((n) => n + 1);
    closeDefeat();
    announce('QR code healed: every micro-cell restored.');
  }, [grid, syncStats, closeDefeat, announce]);

  const releasePointer = () => {
    pointerDownRef.current = false;
    scan.settle();
  };

  const durabilityTone = healthTone(durability.percent);
  const weaponChoices = BLASTER_WEAPONS.map((w) => ({ value: w.id, label: `${w.shortcut} ${w.name}`, ariaLabel: w.name }));

  return (
    <>
      <ArcadeCockpit
        settings={settings}
        arsenal={
          <Card variant="control" className="space-y-3">
            <h2 className="text-sm font-bold text-fg">Blaster weapons</h2>
            <SegmentedControl<BlasterWeaponId>
              appearance="tiles"
              label="Blaster weapons"
              className="grid-cols-1"
              options={BLASTER_WEAPONS.map((w) => ({
                value: w.id,
                ariaLabel: w.name,
                label: (
                  <span className="flex w-full flex-col items-start text-left">
                    <span className="font-bold">
                      <kbd className="mr-1 rounded border border-current px-1 font-mono text-xs">{w.shortcut}</kbd>
                      {w.name}
                    </span>
                    <span className="text-xs font-normal">{w.description}</span>
                  </span>
                ),
              }))}
              value={weapon}
              onChange={selectWeapon}
            />
            <ToggleSwitch id="arcade-auto-fire" label="Rapid Auto-Fire (plasma)" checked={autoFire} onChange={setAutoFire} />
          </Card>
        }
        arena={
          <div className="mx-auto w-full max-w-[min(100%,34rem)] rounded-2xl border-2 border-line bg-surface p-2">
            <canvas
              ref={canvasRef}
              width={A.width}
              height={A.height}
              tabIndex={0}
              role="img"
              aria-label="Arcade blaster arena. Aim with the pointer and click or tap to fire; keys 1, 2 and 3 switch weapons and Space fires."
              className="block aspect-[5/6] w-full cursor-crosshair rounded-lg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              style={{ touchAction: 'none' }}
              data-testid="arcade-blaster-canvas"
              onPointerMove={(event) => {
                aimRef.current = toArena(event);
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Pointer capture is best-effort.
                }
                aimRef.current = toArena(event);
                pointerDownRef.current = true;
                trigger();
              }}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
              onLostPointerCapture={releasePointer}
              onKeyDown={(event) => {
                const step = 12;
                const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
                const move = moves[event.key];
                if (!move) return;
                event.preventDefault();
                aimRef.current = {
                  x: Math.max(0, Math.min(A.width, aimRef.current.x + move[0])),
                  y: Math.max(0, Math.min(A.height, aimRef.current.y + move[1])),
                };
              }}
            />
          </div>
        }
        quickBar={
          <div className="space-y-2">
            <SegmentedControl<BlasterWeaponId>
              appearance="tiles"
              label="Weapon"
              className="grid-cols-3"
              options={weaponChoices}
              value={weapon}
              onChange={selectWeapon}
            />
            <ToggleSwitch id="arcade-auto-fire-quick" label="Rapid Auto-Fire" checked={autoFire} onChange={setAutoFire} />
          </div>
        }
        hints={
          <p className="text-center text-xs text-fg-muted">
            Move the pointer to aim · click or Space to fire · 1, 2, 3 switch weapons · arrow keys aim when the arena is focused
          </p>
        }
        hud={<ScanHud analysis={analysis} empirical={scan.state} isNative={scan.isNative} />}
        actions={
          <Card variant="control" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-fg">Durability</h2>
              <span className="font-mono text-2xl font-black text-fg" data-testid="arcade-durability">
                {durability.percent}%
              </span>
            </div>
            <div
              role="meter"
              aria-label="Micro-cell durability"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={durability.percent}
              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            >
              <div
                className={`h-full rounded-full ${durabilityTone === 'healthy' ? 'bg-teal-600' : durabilityTone === 'warning' ? 'bg-amber-500' : 'bg-rose-600'}`}
                style={{ width: `${durability.percent}%` }}
              />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-center text-xs text-fg-muted">
              <div>
                <dt>Intact micro-cells</dt>
                <dd className="font-mono text-sm font-bold text-fg" data-testid="arcade-intact">
                  {durability.intact} / {durability.original}
                </dd>
              </div>
              <div>
                <dt>Blasted away</dt>
                <dd className="font-mono text-sm font-bold text-fg" data-testid="arcade-blasted">
                  {durability.destroyed}
                </dd>
              </div>
            </dl>
            <Button variant="secondary" fullWidth onClick={heal}>
              <HeartPulse className="size-4" aria-hidden="true" />
              Heal QR Code
            </Button>
          </Card>
        }
        telemetry={
          <Card variant="control">
            <h2 className="mb-3 text-sm font-bold text-fg">Telemetry</h2>
            <dl className="grid grid-cols-2 gap-3 text-xs text-fg-muted">
              <div><dt>QR grid</dt><dd className="font-bold text-fg">{matrix.size} × {matrix.size}</dd></div>
              <div><dt>Micro grid</dt><dd className="font-bold text-fg">{grid.size} × {grid.size}</dd></div>
              <div><dt>Damaged modules</dt><dd className="font-bold text-fg">{analysis.damagedCount}</dd></div>
              <div><dt>Decoder</dt><dd className="font-bold text-fg">{scan.isNative ? 'BarcodeDetector' : 'Web Worker'}</dd></div>
            </dl>
          </Card>
        }
      />
      <DefeatModal isOpen={defeatOpen} analysis={analysis} onRebuild={heal} onClose={closeDefeat} />
    </>
  );
}
