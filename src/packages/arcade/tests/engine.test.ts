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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { isFinderPattern } from '@/packages/qr-matrix';
import {
  analyzeDamage,
  applyBlast,
  blankTargetMatrix,
  buildTargetMatrix,
  finderAt,
  FALLBACK_PAYLOAD,
  healthTone,
  isDarkModule,
  modulesInBlast,
  planBarrage,
  parseArcadeMode,
  arcadeModeHref,
  blasterWeaponForKey,
  SIMULATOR_WEAPONS,
  BLASTER_WEAPONS,
  VIRTUAL_BLOCK_COUNT,
} from '../index';
import { clearStagedArcadeTarget, getStagedArcadeTarget, stageArcadeTarget } from '../handoff';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('target matrix', () => {
  it('builds the matrix with a single encode', () => {
    const create = vi.spyOn(QRCode, 'create');
    const matrix = buildTargetMatrix('https://qrcraftly.com', 'H', QRCode);
    expect(create).toHaveBeenCalledTimes(1);
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    expect(matrix.modules).toHaveLength(matrix.size * matrix.size);
    expect(matrix.payload).toBe('https://qrcraftly.com');
    expect(matrix.usedFallback).toBe(false);
    // Finder corners are dark in every QR code.
    expect(isDarkModule(matrix, 0, 0)).toBe(true);
    expect(isDarkModule(matrix, -1, 0)).toBe(false);
  });

  it('encodes the payload verbatim, without re-normalizing it', () => {
    const create = vi.spyOn(QRCode, 'create');
    const matrix = buildTargetMatrix('example.com', 'Q', QRCode);
    expect(create).toHaveBeenCalledWith('example.com', { errorCorrectionLevel: 'Q' });
    expect(matrix.payload).toBe('example.com');
    expect(matrix.ecc).toBe('Q');
  });

  it('falls back when the payload is empty or too long', () => {
    expect(buildTargetMatrix('', 'L', QRCode)).toMatchObject({ payload: FALLBACK_PAYLOAD, usedFallback: true });
    expect(buildTargetMatrix('x'.repeat(5000), 'H', QRCode)).toMatchObject({ payload: FALLBACK_PAYLOAD, usedFallback: true });
  });

  it('stands in with a blank board while the encoder loads', () => {
    const blank = blankTargetMatrix('example.com', 'M');
    expect(blank).toMatchObject({ size: 25, payload: 'example.com', ecc: 'M', usedFallback: false });
    expect(blank.modules.every((m) => m === 0)).toBe(true);
  });

  it('shares finder geometry with the renderer', () => {
    const size = 25;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        expect(finderAt(r, c, size) !== null).toBe(isFinderPattern(r, c, size));
      }
    }
    expect(finderAt(0, 0, size)).toBe('topLeft');
    expect(finderAt(6, 24, size)).toBe('topRight');
    expect(finderAt(24, 3, size)).toBe('bottomLeft');
    expect(finderAt(24, 24, size)).toBeNull();
  });
});

describe('damage radius maths', () => {
  it('maps each simulator weapon radius to its blast area', () => {
    const size = 41;
    const counts = SIMULATOR_WEAPONS.map((w) => modulesInBlast(size, 20, 20, w.radius).length);
    expect(counts[0]).toBe(1); // Pinpoint: one module
    expect(counts[1]).toBe(9); // Plasma Charge: 3x3
    expect(counts[2]).toBe(21); // Neutron Blast: rounded 5x5
    const nuke = modulesInBlast(size, 20, 20, 4);
    expect(nuke.length).toBeGreaterThan(49);
    for (const index of nuke) {
      expect(Math.abs(Math.floor(index / size) - 20)).toBeLessThanOrEqual(4);
      expect(Math.abs((index % size) - 20)).toBeLessThanOrEqual(4);
    }
  });

  it('clips blasts at the matrix edge', () => {
    expect(modulesInBlast(21, 0, 0, 1).sort((a, b) => a - b)).toEqual([0, 1, 21, 22]);
  });

  it('applies blasts without mutating the previous damage set', () => {
    const before = new Set<number>([5]);
    const after = applyBlast(before, 21, 10, 10, 0);
    expect(before.size).toBe(1);
    expect(after.has(10 * 21 + 10)).toBe(true);
    expect(after.has(5)).toBe(true);
  });

  it('plans deterministic barrages from an injected random source', () => {
    let seed = 0;
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const strikes = planBarrage(25, 12, [0, 1, 2, 4], random);
    expect(strikes).toHaveLength(12);
    for (const strike of strikes) {
      expect(strike.row).toBeGreaterThanOrEqual(0);
      expect(strike.row).toBeLessThan(25);
      expect([0, 1, 2, 4]).toContain(strike.radius);
    }
  });
});

describe('Reed-Solomon analytics', () => {
  const size = 21; // 441 modules; ECC H budget 132, block budget 33
  const nonFinder: number[] = [];
  for (let i = 0; i < size * size; i++) if (!finderAt(Math.floor(i / size), i % size, size)) nonFinder.push(i);

  it('reports full health for an undamaged code', () => {
    const a = analyzeDamage([], size, 'H');
    expect(a).toMatchObject({ budget: 132, blockBudget: 33, healthPercent: 100, failure: null, damagedCount: 0 });
    expect(a.blockDamage).toHaveLength(VIRTUAL_BLOCK_COUNT);
  });

  it('takes the worse of global and worst-block consumption', () => {
    const damage = nonFinder.filter((i) => i % VIRTUAL_BLOCK_COUNT === 0).slice(0, 11); // 11 of 33 in one block
    const a = analyzeDamage(damage, size, 'H');
    expect(a.maxBlockDamage).toBe(11);
    expect(a.healthPercent).toBe(67);
    expect(a.failure).toBeNull();
  });

  it('forces health to 0 when more than 20% of a finder is damaged', () => {
    const topLeft = [];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) topLeft.push(r * size + c);
    const nine = analyzeDamage(topLeft.slice(0, 9), size, 'H'); // 18%
    expect(nine.isFinderOffline).toBe(false);
    expect(nine.healthPercent).toBeGreaterThan(0);
    const ten = analyzeDamage(topLeft.slice(0, 10), size, 'H'); // 20.4%
    expect(ten.isFinderOffline).toBe(true);
    expect(ten.failure).toBe('finder');
    expect(ten.healthPercent).toBe(0);
    expect(ten.finderDamage.topLeft).toBe(10);
  });

  it('detects local block overflow before the global budget is spent', () => {
    const damage = nonFinder.filter((i) => i % VIRTUAL_BLOCK_COUNT === 1).slice(0, 34);
    const a = analyzeDamage(damage, size, 'H');
    expect(a.isBlockBudgetExceeded).toBe(true);
    expect(a.isGlobalBudgetExhausted).toBe(false);
    expect(a.failure).toBe('block');
    expect(a.healthPercent).toBe(0);
  });

  it('detects global budget exhaustion when damage is spread evenly', () => {
    const byBlock = [0, 1, 2, 3].map((b) => nonFinder.filter((i) => i % VIRTUAL_BLOCK_COUNT === b).slice(0, 33));
    const a = analyzeDamage(byBlock.flat(), size, 'H');
    expect(a.damagedCount).toBe(132);
    expect(a.isBlockBudgetExceeded).toBe(false);
    expect(a.failure).toBe('global');
  });

  it('never reports 0% without a failure', () => {
    const damage = nonFinder.filter((i) => i % VIRTUAL_BLOCK_COUNT === 2).slice(0, 33);
    const a = analyzeDamage(damage, size, 'H');
    expect(a.failure).toBeNull();
    expect(a.healthPercent).toBe(1);
  });

  it('maps health to emerald, amber and rose bands', () => {
    expect(healthTone(100)).toBe('healthy');
    expect(healthTone(61)).toBe('healthy');
    expect(healthTone(60)).toBe('warning');
    expect(healthTone(26)).toBe('warning');
    expect(healthTone(25)).toBe('critical');
    expect(healthTone(0)).toBe('critical');
  });
});

describe('modes and weapons', () => {
  it('parses and formats the mode query parameter', () => {
    expect(parseArcadeMode('?mode=simulator')).toBe('simulator');
    expect(parseArcadeMode('?mode=blaster')).toBe('blaster');
    expect(parseArcadeMode('')).toBe('blaster');
    expect(parseArcadeMode('?mode=../../etc')).toBe('blaster');
    expect(arcadeModeHref('simulator')).toBe('/arcade?mode=simulator');
  });

  it('binds 1, 2 and 3 to the three blaster weapons', () => {
    expect(BLASTER_WEAPONS.map((w) => w.name)).toEqual(['Plasma Blaster', 'Thermal Laser', 'Antimatter Rocket']);
    expect(blasterWeaponForKey('1')).toBe('plasma');
    expect(blasterWeaponForKey('2')).toBe('laser');
    expect(blasterWeaponForKey('3')).toBe('rocket');
    expect(blasterWeaponForKey('4')).toBeNull();
  });

  it('defines the four simulator weapons with their radii', () => {
    expect(SIMULATOR_WEAPONS.map((w) => [w.name, w.radius])).toEqual([
      ['Pinpoint Laser', 0],
      ['Plasma Charge', 1],
      ['Neutron Blast', 2],
      ['Thermonuclear Nuke', 4],
    ]);
  });
});

describe('generator handoff', () => {
  it('stages the design in memory and returns copies', () => {
    clearStagedArcadeTarget();
    expect(getStagedArcadeTarget()).toBeNull();
    const design = { payload: 'hello', ecc: 'Q' as const, fgColor: '#111111', bgColor: '#ffffff', eyeColor: '#222222' };
    stageArcadeTarget(design);
    design.payload = 'mutated';
    const staged = getStagedArcadeTarget();
    expect(staged?.payload).toBe('hello');
    if (staged) staged.payload = 'changed';
    expect(getStagedArcadeTarget()?.payload).toBe('hello');
    clearStagedArcadeTarget();
    expect(getStagedArcadeTarget()).toBeNull();
  });
});
