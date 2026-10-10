/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
 * Real BC-UR (BCR-2024-001) multipart codec, for wallet interop. Not the pseudo
 * BC-UR droplets of `lib/fountain` (ADR 0014): those share the `ur:bytes/<seq>-<n>/`
 * look but use a different mixing schedule.
 */
export { isBcUr } from './uri';
export { BcUrDecoder, MAX_BCUR_FRAGMENTS, type BcUrIngest, type BcUrResult } from './decoder';
export { BcUrEncoder } from './encoder';
