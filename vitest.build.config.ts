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

/**
 * Vitest configuration for the checks that read the real build in `dist/client` (#1609). They
 * run with `pnpm run test:build` after `pnpm run build` (the CI Build job does this), not in
 * the unit run, which has no build. A missing build fails them instead of skipping them.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'build-output',
    environment: 'node',
    include: ['tests/build-output/**/*.test.ts'],
  },
});
