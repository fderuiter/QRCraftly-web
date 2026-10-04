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
 * The QR encoder for tests and scripts that need one synchronously: the committed
 * `src/wasm/qr-encode.wasm`, compiled and instantiated from disk at import time.
 * App code loads it with `loadQrEncoder` instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQrEncoder, type QrSymbolEncoder } from '../../src/packages/qr-matrix';
import { instantiateWasmSync } from '../../src/packages/wasm-runtime';

const WASM_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/wasm/qr-encode.wasm');

export const qrEncoder: QrSymbolEncoder = createQrEncoder(instantiateWasmSync(new WebAssembly.Module(fs.readFileSync(WASM_PATH))));
