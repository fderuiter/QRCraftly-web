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

import type { MicroCell, MicroGrid } from './microGrid';

/** Logical layout of the blaster arena, in arena pixels (independent of display size). */
export interface ArenaGeometry {
  /** Arena width. */
  width: number;
  /** Arena height. */
  height: number;
  /** Left edge of the QR target. */
  qrX: number;
  /** Top edge of the QR target. */
  qrY: number;
  /** Side of the QR target. */
  qrSize: number;
  /** Cannon pivot x. */
  cannonX: number;
  /** Cannon pivot y. */
  cannonY: number;
}

/** Portrait arena: the target sits near the top and the cannon at the bottom centre. */
export const BLASTER_ARENA: ArenaGeometry = {
  width: 600,
  height: 720,
  qrX: 100,
  qrY: 60,
  qrSize: 400,
  cannonX: 300,
  cannonY: 690,
};

/** A point in arena coordinates. */
export interface Point {
  /** Horizontal coordinate. */
  x: number;
  /** Vertical coordinate. */
  y: number;
}

/** The on-screen box of a canvas (a subset of `DOMRect`). */
export interface DisplayRect {
  /** Left edge in CSS pixels. */
  left: number;
  /** Top edge in CSS pixels. */
  top: number;
  /** Width in CSS pixels. */
  width: number;
  /** Height in CSS pixels. */
  height: number;
}

/**
 * Maps a pointer position in CSS pixels to logical arena coordinates, whatever the displayed
 * size or device pixel ratio of the canvas.
 * @param clientX - Pointer x in CSS pixels.
 * @param clientY - Pointer y in CSS pixels.
 * @param rect - The canvas's on-screen box.
 * @param width - Logical arena width.
 * @param height - Logical arena height.
 * @returns The arena point (clamped to the arena).
 */
export function mapPointerToArena(clientX: number, clientY: number, rect: DisplayRect, width: number, height: number): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const x = ((clientX - rect.left) / rect.width) * width;
  const y = ((clientY - rect.top) / rect.height) * height;
  return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)) };
}

/**
 * Backing-store size for a canvas so it renders crisply at the device pixel ratio.
 * @param cssWidth - Displayed width in CSS pixels.
 * @param cssHeight - Displayed height in CSS pixels.
 * @param devicePixelRatio - The device pixel ratio.
 * @returns Integer backing-store dimensions (at least 1x1, capped at 3x).
 */
export function backingStoreSize(cssWidth: number, cssHeight: number, devicePixelRatio: number): { width: number; height: number } {
  const ratio = Math.min(3, Math.max(1, devicePixelRatio || 1));
  return { width: Math.max(1, Math.round(cssWidth * ratio)), height: Math.max(1, Math.round(cssHeight * ratio)) };
}

/**
 * Angle of the cannon barrel pointing at a target.
 * @param geometry - Arena layout.
 * @param target - Aim point.
 * @returns Angle in radians (0 = pointing right).
 */
export function aimAngle(geometry: ArenaGeometry, target: Point): number {
  return Math.atan2(target.y - geometry.cannonY, target.x - geometry.cannonX);
}

/** Projectile weapons (the laser is a continuous beam, not a projectile). */
export type ProjectileKind = 'plasma' | 'rocket';

/** Tuning for each projectile kind. */
export const PROJECTILE_SPECS: Readonly<Record<ProjectileKind, { speed: number; radius: number; recoilShake: number }>> = {
  plasma: { speed: 14, radius: 5, recoilShake: 1.2 },
  rocket: { speed: 8, radius: 12, recoilShake: 3.5 },
};

/** Blast radius of a rocket detonation in arena pixels. */
export const ROCKET_BLAST_RADIUS = 55;

/** Burn radius of the thermal laser in arena pixels. */
export const LASER_BURN_RADIUS = 10;

/** At most this many rockets may be in flight at once. */
export const MAX_ROCKETS_IN_FLIGHT = 3;

/** A projectile in flight. */
export interface Projectile {
  /** Position x. */
  x: number;
  /** Position y. */
  y: number;
  /** Velocity x per frame. */
  vx: number;
  /** Velocity y per frame. */
  vy: number;
  /** Collision radius. */
  radius: number;
  /** Weapon that fired it. */
  kind: ProjectileKind;
}

/**
 * Spawns a projectile at the cannon, flying toward the aim point.
 * @param kind - Projectile weapon.
 * @param geometry - Arena layout.
 * @param target - Aim point.
 * @returns The projectile, or null when the aim point is the cannon itself.
 */
export function spawnProjectile(kind: ProjectileKind, geometry: ArenaGeometry, target: Point): Projectile | null {
  const dx = target.x - geometry.cannonX;
  const dy = target.y - geometry.cannonY;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return null;
  const spec = PROJECTILE_SPECS[kind];
  return {
    x: geometry.cannonX,
    y: geometry.cannonY,
    vx: (dx / distance) * spec.speed,
    vy: (dy / distance) * spec.speed,
    radius: spec.radius,
    kind,
  };
}

/** Something that hit the target this frame. */
export interface Impact {
  /** Impact x in arena pixels. */
  x: number;
  /** Impact y in arena pixels. */
  y: number;
  /** What caused it. */
  kind: ProjectileKind | 'laser';
  /** Micro-cells destroyed. */
  destroyed: MicroCell[];
}

function toMicro(geometry: ArenaGeometry, grid: MicroGrid, x: number, y: number, radius: number) {
  const cell = geometry.qrSize / grid.size;
  return { mx: (x - geometry.qrX) / cell, my: (y - geometry.qrY) / cell, mr: radius / cell };
}

/**
 * Advances every projectile one frame, resolving collisions with the micro-grid. Plasma bolts
 * chip the cell they hit; rockets detonate and blast every cell within
 * {@link ROCKET_BLAST_RADIUS}. Spent and off-arena projectiles are removed in place.
 * @param projectiles - Projectiles in flight (mutated).
 * @param grid - The damage grid (mutated).
 * @param geometry - Arena layout.
 * @returns The impacts of this frame.
 */
export function stepProjectiles(projectiles: Projectile[], grid: MicroGrid, geometry: ArenaGeometry): Impact[] {
  const impacts: Impact[] = [];
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -50 || p.x > geometry.width + 50 || p.y < -50 || p.y > geometry.height + 50) {
      projectiles.splice(i, 1);
      continue;
    }
    const { mx, my, mr } = toMicro(geometry, grid, p.x, p.y, p.radius);
    const hit = grid.firstHit(mx, my, mr);
    if (!hit) continue;
    let destroyed: MicroCell[];
    if (p.kind === 'rocket') {
      const blast = toMicro(geometry, grid, p.x, p.y, ROCKET_BLAST_RADIUS);
      destroyed = grid.blastCircle(blast.mx, blast.my, blast.mr);
    } else {
      destroyed = grid.blastCircle(hit.col + 0.5, hit.row + 0.5, 0.5);
    }
    impacts.push({ x: p.x, y: p.y, kind: p.kind, destroyed });
    projectiles.splice(i, 1);
  }
  return impacts;
}

/**
 * Applies one frame of continuous thermal-laser damage around the aim point.
 * @param grid - The damage grid (mutated).
 * @param geometry - Arena layout.
 * @param target - Aim point.
 * @returns The impact, or null when nothing burned.
 */
export function burnLaser(grid: MicroGrid, geometry: ArenaGeometry, target: Point): Impact | null {
  const { mx, my, mr } = toMicro(geometry, grid, target.x, target.y, LASER_BURN_RADIUS);
  const destroyed = grid.blastCircle(mx, my, mr);
  return destroyed.length > 0 ? { x: target.x, y: target.y, kind: 'laser', destroyed } : null;
}

/** Colour role of a particle; the renderer maps roles to theme colours. */
export type ParticleTone = 'primary' | 'hot' | 'accent';

/** A visual spark. */
export interface Particle {
  /** Position x. */
  x: number;
  /** Position y. */
  y: number;
  /** Velocity x per frame. */
  vx: number;
  /** Velocity y per frame. */
  vy: number;
  /** Render radius. */
  radius: number;
  /** Opacity, 0-1. */
  alpha: number;
  /** Opacity lost per frame. */
  decay: number;
  /** Whether gravity pulls it down. */
  gravity: boolean;
  /** Colour role. */
  tone: ParticleTone;
}

/** Hard cap on live particles so long sessions stay smooth. */
export const MAX_PARTICLES = 600;

/**
 * Creates a burst of sparks.
 * @param origin - Burst centre.
 * @param count - Number of sparks.
 * @param options - Spread speed, size, colour role, gravity and an optional carried velocity.
 * @param options.speed - Maximum spark speed.
 * @param options.tone - Colour role.
 * @param options.gravity - Whether sparks fall.
 * @param options.size - Maximum extra spark radius.
 * @param options.drift - Velocity added to every spark.
 * @param random - Random source in [0, 1).
 * @returns The sparks.
 */
export function burst(
  origin: Point,
  count: number,
  options: { speed: number; tone: ParticleTone; gravity: boolean; size?: number; drift?: Point },
  random: () => number = Math.random
): Particle[] {
  const sparks: Particle[] = [];
  for (let i = 0; i < count; i++) {
    sparks.push({
      x: origin.x,
      y: origin.y,
      vx: (random() - 0.5) * options.speed + (options.drift?.x ?? 0),
      vy: (random() - 0.5) * options.speed + (options.drift?.y ?? 0),
      radius: 1 + random() * (options.size ?? 2.5),
      alpha: 1,
      decay: 0.025 + random() * 0.035,
      gravity: options.gravity,
      tone: options.tone,
    });
  }
  return sparks;
}

/**
 * Adds sparks while enforcing {@link MAX_PARTICLES} (oldest sparks are dropped first).
 * @param particles - Live particles (mutated).
 * @param sparks - New sparks.
 */
export function addParticles(particles: Particle[], sparks: Particle[]): void {
  particles.push(...sparks);
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

/**
 * Advances every particle one frame (motion, gravity, fade) and removes faded ones in place.
 * @param particles - Live particles (mutated).
 */
export function stepParticles(particles: Particle[]): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    if (pt.gravity) pt.vy += 0.12;
    pt.alpha -= pt.decay;
    if (pt.alpha <= 0) particles.splice(i, 1);
  }
}

/** Screen-shake added per event, and its cap. */
export const SHAKE: Readonly<Record<ProjectileKind | 'laser' | 'plasmaHit' | 'rocketHit', { add: number; cap: number }>> = {
  plasma: { add: PROJECTILE_SPECS.plasma.recoilShake, cap: 5 },
  rocket: { add: PROJECTILE_SPECS.rocket.recoilShake, cap: 8 },
  laser: { add: 0.8, cap: 4 },
  plasmaHit: { add: 3.5, cap: 9 },
  rocketHit: { add: 18, cap: 25 },
};

/**
 * Adds screen shake for an event, proportional to its magnitude and capped. Returns 0 when
 * reduced motion is requested.
 * @param current - Current shake magnitude.
 * @param event - The event.
 * @param reducedMotion - Whether the visitor prefers reduced motion.
 * @returns The new shake magnitude.
 */
export function addShake(current: number, event: keyof typeof SHAKE, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const { add, cap } = SHAKE[event];
  return Math.max(current, Math.min(current + add, cap));
}

/**
 * Decays screen shake by one frame.
 * @param current - Current shake magnitude.
 * @returns The decayed magnitude (0 once negligible).
 */
export function decayShake(current: number): number {
  const next = current * 0.92;
  return next < 0.05 ? 0 : next;
}
