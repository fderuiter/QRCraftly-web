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

/**
 * QR Arcade engine: the headless game logic behind /arcade.
 *
 * - Target matrix: one encode per target, shared by both modes and the scan painter.
 * - Damage Simulator: circular module blasts, artillery barrages and Layer 1 analytics
 *   (Reed-Solomon budget, interleaved virtual blocks, 20% finder damage threshold).
 * - Arcade Blaster: 4x4 micro-cell damage grid, projectile/laser/particle physics and shake.
 * - Layer 2: the empirical scan pipeline (native BarcodeDetector, then the Scannability Worker).
 */

export {
  blankTargetMatrix,
  buildTargetMatrix,
  isDarkModule,
  finderAt,
  ECC_LEVELS,
  FALLBACK_PAYLOAD,
  type EccLevel,
  type TargetMatrix,
} from './lib/matrix';
export {
  analyzeDamage,
  applyBlast,
  modulesInBlast,
  planBarrage,
  healthTone,
  ECC_RECOVERY,
  VIRTUAL_BLOCK_COUNT,
  type DamageAnalysis,
  type FailureCause,
  type HealthTone,
} from './lib/damage';
export { MicroGrid, MICRO_SUBDIVISION } from './lib/microGrid';
export {
  BLASTER_ARENA,
  PROJECTILE_SPECS,
  MAX_ROCKETS_IN_FLIGHT,
  MAX_PARTICLES,
  mapPointerToArena,
  backingStoreSize,
  aimAngle,
  spawnProjectile,
  stepProjectiles,
  burnLaser,
  burst,
  addParticles,
  stepParticles,
  addShake,
  decayShake,
  type Impact,
  type Particle,
  type ParticleTone,
  type Point,
  type Projectile,
  type ProjectileKind,
} from './lib/physics';
export {
  ARCADE_MODES,
  BLASTER_WEAPONS,
  SIMULATOR_WEAPONS,
  BARRAGE_STRIKES,
  parseArcadeMode,
  arcadeModeHref,
  blasterWeaponForKey,
  type ArcadeMode,
  type BlasterWeaponId,
  type SimulatorWeaponId,
} from './lib/modes';
export {
  EmpiricalScanPipeline,
  paintScanFrame,
  SCAN_FRAME_SIZE,
  SCAN_WATCHDOG_MS,
  type DetectorLike,
  type ScanOutcome,
  type WorkerLike,
} from './lib/scanPipeline';
