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

import { describe, it, expect } from 'vitest';
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import {
  addParticles,
  addShake,
  aimAngle,
  backingStoreSize,
  BLASTER_ARENA,
  burnLaser,
  burst,
  buildTargetMatrix,
  decayShake,
  mapPointerToArena,
  MAX_PARTICLES,
  MicroGrid,
  MICRO_SUBDIVISION,
  PROJECTILE_SPECS,
  spawnProjectile,
  stepParticles,
  stepProjectiles,
  type TargetMatrix,
  type Projectile,
  type Particle,
} from '../index';

/** A 2x2 checkerboard: dark modules at (0,0) and (1,1). */
const checker: TargetMatrix = { size: 2, modules: Uint8Array.from([1, 0, 0, 1]), payload: 'x', ecc: 'L', usedFallback: false };

describe('micro-cell grid', () => {
  it('subdivides every dark module into a 4x4 micro-grid', () => {
    const grid = new MicroGrid(checker);
    expect(MICRO_SUBDIVISION).toBe(4);
    expect(grid.size).toBe(8);
    expect(grid.originalDark).toBe(32);
    expect(grid.intactDark).toBe(32);
    expect(grid.durabilityPercent).toBe(100);
    expect(grid.isIntact(0, 0)).toBe(true);
    expect(grid.isIntact(0, 4)).toBe(false); // light module
  });

  it('chips micro-cells and updates intact, blasted and durability counts', () => {
    const grid = new MicroGrid(checker);
    const destroyed = grid.blastCircle(0.5, 0.5, 0.5); // exactly one cell
    expect(destroyed).toEqual([{ row: 0, col: 0 }]);
    expect(grid.intactDark).toBe(31);
    expect(grid.destroyed).toBe(1);
    expect(grid.durabilityPercent).toBe(97);
    expect(grid.wasDark(0, 0)).toBe(true);
    expect(grid.isIntact(0, 0)).toBe(false);
    expect(grid.destroyedInModule(0, 0)).toBe(1);
    // Blasting the same spot again destroys nothing more.
    expect(grid.blastCircle(0.5, 0.5, 0.5)).toEqual([]);
  });

  it('counts a module as damaged once half of its micro-cells are gone', () => {
    const grid = new MicroGrid(checker);
    grid.blastCircle(2, 1, 1.2); // a few cells
    expect(grid.macroDamage()).toEqual([]);
    grid.blastCircle(2, 2, 2.9); // most of module (0,0)
    expect(grid.destroyedInModule(0, 0)).toBeGreaterThanOrEqual(8);
    expect(grid.macroDamage()).toEqual([0]);
  });

  it('heals every blasted cell', () => {
    const grid = new MicroGrid(checker);
    grid.blastCircle(4, 4, 10);
    expect(grid.intactDark).toBe(0);
    grid.heal();
    expect(grid.intactDark).toBe(32);
    expect(grid.macroDamage()).toEqual([]);
    expect(grid.destroyedInModule(1, 1)).toBe(0);
  });

  it('finds circle-rectangle collisions only with intact dark cells', () => {
    const grid = new MicroGrid(checker);
    expect(grid.firstHit(6, 2, 0.4)).toBeNull(); // light module area
    expect(grid.firstHit(1.5, 1.5, 0.4)).toEqual({ row: 1, col: 1 });
  });
});

describe('arena coordinates', () => {
  it('maps pointer positions onto the logical arena at any display size', () => {
    const rect = { left: 10, top: 20, width: 300, height: 360 };
    expect(mapPointerToArena(160, 200, rect, 600, 720)).toEqual({ x: 300, y: 360 });
    expect(mapPointerToArena(10, 20, rect, 600, 720)).toEqual({ x: 0, y: 0 });
    // Clamped outside the canvas; zero-size rects are safe.
    expect(mapPointerToArena(1000, -50, rect, 600, 720)).toEqual({ x: 600, y: 0 });
    expect(mapPointerToArena(5, 5, { left: 0, top: 0, width: 0, height: 0 }, 600, 720)).toEqual({ x: 0, y: 0 });
  });

  it('sizes the backing store for the device pixel ratio', () => {
    expect(backingStoreSize(300, 360, 2)).toEqual({ width: 600, height: 720 });
    expect(backingStoreSize(300, 360, 0)).toEqual({ width: 300, height: 360 });
    expect(backingStoreSize(100, 100, 8)).toEqual({ width: 300, height: 300 });
  });

  it('swivels the cannon toward the aim point', () => {
    const A = BLASTER_ARENA;
    expect(aimAngle(A, { x: A.cannonX, y: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(aimAngle(A, { x: A.width, y: A.cannonY })).toBeCloseTo(0);
    expect(aimAngle(A, { x: 0, y: A.cannonY })).toBeCloseTo(Math.PI);
  });
});

describe('projectile physics', () => {
  const A = BLASTER_ARENA;
  const matrix = buildTargetMatrix('ARCADE', 'L', qrEncoder);
  const cellPx = A.qrSize / (matrix.size * MICRO_SUBDIVISION);
  // Centre of the top-left finder's outer ring micro-cell (0,0): always dark.
  const topLeft = { x: A.qrX + cellPx / 2, y: A.qrY + cellPx / 2 };

  it('fires projectiles from the cannon at the weapon speed', () => {
    const p = spawnProjectile('plasma', A, { x: A.cannonX, y: 0 });
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.vx, p!.vy)).toBeCloseTo(PROJECTILE_SPECS.plasma.speed);
    expect(spawnProjectile('rocket', A, { x: A.cannonX, y: A.cannonY })).toBeNull();
  });

  it('plasma bolts chip exactly one micro-cell on impact', () => {
    const grid = new MicroGrid(matrix);
    const bolt: Projectile = { x: topLeft.x, y: topLeft.y - 1, vx: 0, vy: 1, radius: 2, kind: 'plasma' };
    const projectiles = [bolt];
    const impacts = stepProjectiles(projectiles, grid, A);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].destroyed).toHaveLength(1);
    expect(grid.destroyed).toBe(1);
    expect(projectiles).toHaveLength(0);
  });

  it('rockets blast a crater of micro-cells', () => {
    const grid = new MicroGrid(matrix);
    const rocket: Projectile = { x: topLeft.x, y: topLeft.y, vx: 0, vy: 0, radius: 12, kind: 'rocket' };
    const impacts = stepProjectiles([rocket], grid, A);
    expect(impacts[0].kind).toBe('rocket');
    expect(impacts[0].destroyed.length).toBeGreaterThan(20);
  });

  it('removes projectiles that leave the arena without hitting anything', () => {
    const grid = new MicroGrid(matrix);
    const stray: Projectile = { x: -45, y: 10, vx: -10, vy: 0, radius: 5, kind: 'plasma' };
    const projectiles = [stray];
    expect(stepProjectiles(projectiles, grid, A)).toEqual([]);
    expect(projectiles).toHaveLength(0);
  });

  it('burns micro-cells under the thermal laser', () => {
    const grid = new MicroGrid(matrix);
    const burn = burnLaser(grid, A, topLeft);
    expect(burn?.kind).toBe('laser');
    expect(burn!.destroyed.length).toBeGreaterThan(0);
    expect(burnLaser(grid, A, { x: 5, y: 5 })).toBeNull();
  });
});

describe('particles and screen shake', () => {
  it('fades particles out and removes them', () => {
    const particles: Particle[] = burst({ x: 0, y: 0 }, 5, { speed: 4, tone: 'primary', gravity: true }, () => 0.5);
    expect(particles).toHaveLength(5);
    for (let i = 0; i < 100; i++) stepParticles(particles);
    expect(particles).toHaveLength(0);
  });

  it('caps live particles', () => {
    const particles: Particle[] = [];
    addParticles(particles, burst({ x: 0, y: 0 }, MAX_PARTICLES + 50, { speed: 1, tone: 'hot', gravity: false }));
    expect(particles).toHaveLength(MAX_PARTICLES);
  });

  it('adds shake proportional to impact magnitude, capped, and none under reduced motion', () => {
    const plasma = addShake(0, 'plasmaHit', false);
    const rocket = addShake(0, 'rocketHit', false);
    expect(rocket).toBeGreaterThan(plasma);
    expect(addShake(24, 'rocketHit', false)).toBe(25);
    expect(addShake(10, 'rocketHit', true)).toBe(0);
    expect(decayShake(10)).toBeCloseTo(9.2);
    expect(decayShake(0.04)).toBe(0);
  });
});
