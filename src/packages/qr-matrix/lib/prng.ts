/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { createMulberry32, fnv1a } from '@/packages/core/math';

/**
 * Deterministic seed-based pseudo-random number generator (Mulberry32), seeded by an FNV-1a
 * hash of the string. Drawing code uses it instead of `Math.random()` so the same settings
 * give the same picture in the preview and in every export (#1397).
 */
export function seedRandom(seedStr: string): () => number {
  return createMulberry32(fnv1a(seedStr));
}
