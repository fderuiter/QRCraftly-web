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

import { type EccLevel, type FinderId, finderAt } from './matrix';

/** Share of modules each error correction tier can recover (approximate QR specification values). */
export const ECC_RECOVERY: Readonly<Record<EccLevel, number>> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

/** Number of virtual Reed-Solomon blocks modules are interleaved across. */
export const VIRTUAL_BLOCK_COUNT = 4;

/** Share of a 7x7 finder pattern that may be damaged before scanners lose alignment. */
export const FINDER_DAMAGE_THRESHOLD = 0.2;

const FINDER_MODULE_COUNT = 49;

/**
 * Module indices (row-major) inside a circular blast: radius 0 hits one module, 1 a 3x3
 * neighbourhood, 2 a rounded 5x5 and 4 a rounded 9x9.
 * @param size - Modules along one side.
 * @param row - Blast centre row.
 * @param col - Blast centre column.
 * @param radius - Blast radius in modules (0 hits exactly one module).
 * @returns The indices of the modules hit, clipped to the matrix.
 */
export function modulesInBlast(size: number, row: number, col: number, radius: number): number[] {
  const hit: number[] = [];
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      // The half-module allowance makes radius 1 a full 3x3 and radius 2 a rounded 5x5.
      if (Math.hypot(r - row, c - col) <= radius + 0.5) hit.push(r * size + c);
    }
  }
  return hit;
}

/**
 * Returns a new damage set with a blast applied.
 * @param damage - Current damaged module indices.
 * @param size - Modules along one side.
 * @param row - Blast centre row.
 * @param col - Blast centre column.
 * @param radius - Blast radius in modules.
 * @returns The new damage set (the input is not modified).
 */
export function applyBlast(damage: ReadonlySet<number>, size: number, row: number, col: number, radius: number): Set<number> {
  const next = new Set(damage);
  for (const index of modulesInBlast(size, row, col, radius)) next.add(index);
  return next;
}

/** One strike of an artillery barrage. */
export interface Strike {
  /** Centre row. */
  row: number;
  /** Centre column. */
  col: number;
  /** Radius in modules. */
  radius: number;
}

/**
 * Plans a random artillery barrage.
 * @param size - Modules along one side.
 * @param count - Number of strikes.
 * @param radii - Radii to choose from (one per available weapon).
 * @param random - Random source in [0, 1); injectable for deterministic tests.
 * @returns The strikes, in firing order.
 */
export function planBarrage(size: number, count: number, radii: readonly number[], random: () => number = Math.random): Strike[] {
  const strikes: Strike[] = [];
  for (let i = 0; i < count; i++) {
    strikes.push({
      row: Math.min(size - 1, Math.floor(random() * size)),
      col: Math.min(size - 1, Math.floor(random() * size)),
      radius: radii[Math.min(radii.length - 1, Math.floor(random() * radii.length))] ?? 0,
    });
  }
  return strikes;
}

/** Why a QR code stopped being decodable. */
export type FailureCause = 'finder' | 'block' | 'global';

/** Layer 1 (analytical) result for a damage state. */
export interface DamageAnalysis {
  /** Total modules in the matrix. */
  totalModules: number;
  /** Modules the error correction tier can recover in total. */
  budget: number;
  /** Damaged modules. */
  damagedCount: number;
  /** Recoverable modules per virtual block. */
  blockBudget: number;
  /** Damaged modules per virtual block. */
  blockDamage: number[];
  /** Most damaged block's count. */
  maxBlockDamage: number;
  /** Damaged modules in each corner finder pattern. */
  finderDamage: Record<FinderId, number>;
  /** Worst finder damage as a share of its 49 modules. */
  worstFinderRatio: number;
  /** A finder pattern is more than {@link FINDER_DAMAGE_THRESHOLD} damaged. */
  isFinderOffline: boolean;
  /** A virtual block holds more damage than its budget. */
  isBlockBudgetExceeded: boolean;
  /** Total damage reached the global budget. */
  isGlobalBudgetExhausted: boolean;
  /** Remaining error correction health, 0-100. */
  healthPercent: number;
  /** The primary failure cause once health is 0, in priority order finder, block, global. */
  failure: FailureCause | null;
}

/**
 * Analyses damage against the Reed-Solomon budget, interleaved virtual blocks and the finder
 * patterns. Pure and synchronous, so it can run on every damage event at frame rate.
 * @param damage - Damaged module indices (row-major).
 * @param size - Modules along one side.
 * @param ecc - Error correction tier.
 * @returns The analysis.
 */
export function analyzeDamage(damage: Iterable<number>, size: number, ecc: EccLevel): DamageAnalysis {
  const totalModules = size * size;
  const budget = Math.floor(totalModules * ECC_RECOVERY[ecc]);
  const blockBudget = Math.floor(budget / VIRTUAL_BLOCK_COUNT);
  const blockDamage = new Array<number>(VIRTUAL_BLOCK_COUNT).fill(0);
  const finderDamage: Record<FinderId, number> = { topLeft: 0, topRight: 0, bottomLeft: 0 };
  let damagedCount = 0;

  for (const index of damage) {
    damagedCount++;
    const finder = finderAt(Math.floor(index / size), index % size, size);
    if (finder) finderDamage[finder]++;
    blockDamage[index % VIRTUAL_BLOCK_COUNT]++;
  }

  const worstFinderRatio = Math.max(finderDamage.topLeft, finderDamage.topRight, finderDamage.bottomLeft) / FINDER_MODULE_COUNT;
  const maxBlockDamage = Math.max(...blockDamage);
  const isFinderOffline = worstFinderRatio > FINDER_DAMAGE_THRESHOLD;
  const isBlockBudgetExceeded = blockBudget > 0 && maxBlockDamage > blockBudget;
  const isGlobalBudgetExhausted = damagedCount >= budget;

  let failure: FailureCause | null = null;
  if (isFinderOffline) failure = 'finder';
  else if (isBlockBudgetExceeded) failure = 'block';
  else if (isGlobalBudgetExhausted) failure = 'global';

  let healthPercent = 0;
  if (!failure) {
    const globalRatio = 1 - damagedCount / budget;
    const blockRatio = blockBudget > 0 ? 1 - maxBlockDamage / blockBudget : globalRatio;
    // Health only reaches 0 on an actual failure, so "0%" always means "defeated".
    healthPercent = Math.max(1, Math.round(Math.min(globalRatio, blockRatio) * 100));
  }

  return {
    totalModules,
    budget,
    damagedCount,
    blockBudget,
    blockDamage,
    maxBlockDamage,
    finderDamage,
    worstFinderRatio,
    isFinderOffline,
    isBlockBudgetExceeded,
    isGlobalBudgetExhausted,
    healthPercent,
    failure,
  };
}

/** Colour band of the health bar. */
export type HealthTone = 'healthy' | 'warning' | 'critical';

/**
 * Health bar band: healthy above 60%, warning above 25%, critical otherwise.
 * @param healthPercent - Remaining health, 0-100.
 * @returns The band.
 */
export function healthTone(healthPercent: number): HealthTone {
  if (healthPercent > 60) return 'healthy';
  if (healthPercent > 25) return 'warning';
  return 'critical';
}
