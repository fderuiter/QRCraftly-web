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

import { QRStyle } from '@/packages/core/types';

/** Patterns whose module shapes scanners read less reliably; the health score marks them down. */
export const LOW_RELIABILITY_PATTERNS: readonly QRStyle[] = [QRStyle.GRUNGE, QRStyle.CIRCUIT, QRStyle.STARBURST];

/**
 * Centralized system limits to keep user interface, validation rules,
 * and documentation perfectly synchronized.
 */
export const SYSTEM_LIMITS = {
  MAX_LOGO_SIZE: 0.3,
};
