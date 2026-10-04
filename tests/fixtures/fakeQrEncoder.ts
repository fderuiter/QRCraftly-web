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
 * Opt-in fake QR encoder, for tests that assert canvas geometry against a known
 * matrix instead of a real QR code.
 *
 * Usage in a test file:
 *
 *   const QRCode = createFakeQrEncoder();
 *   useCanvasEncoder(QRCode);
 */
import { afterEach, beforeEach, vi } from 'vitest';
import type { QrEncoder } from '../../src/packages/qr-matrix';
import { setQrCanvasRuntime } from '../../src/utils/qrCanvasRuntime';

const FAKE_SIZE = 21;

/**
 * Builds an encoder whose `create` returns a 21x21 matrix with two dark modules
 * at (0, 0) and (10, 10). Tests override `create` or `modules.get` per case.
 */
export function createFakeQrEncoder() {
  const create = vi.fn((value: string, _options?: unknown) => {
    if (!value) throw new Error('Value is required');
    return {
      modules: {
        size: FAKE_SIZE,
        data: new Uint8Array(FAKE_SIZE * FAKE_SIZE),
        get: vi.fn((r: number, c: number) => (r === 0 && c === 0) || (r === 10 && c === 10)),
      },
    };
  });
  return { create };
}

/**
 * Makes `QRCanvas` encode with the given encoder (usually a fake) for every test in the file.
 */
export function useCanvasEncoder(encoder: QrEncoder): void {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = setQrCanvasRuntime({ loadEncoder: () => encoder });
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });
}
