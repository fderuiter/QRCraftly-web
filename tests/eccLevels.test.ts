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

// Lives outside core because core may import no other package (ADR 0052).
import { describe, expectTypeOf, it } from 'vitest';
import type { EccLevel } from '@/packages/core/ecc';
import type { EccLevel as ArcadeEccLevel } from '@/packages/arcade';
import type { QrReadLevel } from '@/packages/qr-decode';
import type { QrEccLetter } from '@/packages/qr-matrix/encoder';
import type { StreamErrorCorrection } from '@/packages/optical-transfer';

describe('error correction levels', () => {
  it('is the one core type behind every former local alias', () => {
    expectTypeOf<QrEccLetter>().toEqualTypeOf<EccLevel>();
    expectTypeOf<QrReadLevel>().toEqualTypeOf<EccLevel>();
    expectTypeOf<ArcadeEccLevel>().toEqualTypeOf<EccLevel>();
    expectTypeOf<StreamErrorCorrection>().toEqualTypeOf<EccLevel>();
  });
});
