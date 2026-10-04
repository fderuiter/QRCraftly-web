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

import { describe, expect, it } from 'vitest';

describe('Foundry canary switch (#1182, ADR 0033)', () => {
  it('builds with the JavaScript implementation unless FOUNDRY_SELFTEST=wasm', () => {
    expect(__FOUNDRY_SELFTEST__).toBe(process.env.FOUNDRY_SELFTEST === 'wasm' ? 'wasm' : 'js');
  });
});
