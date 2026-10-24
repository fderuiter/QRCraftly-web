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

import { checkStatus, compileWasmUrl, instantiateWasm, type WasmInstance, wasmModuleUrl } from '@/packages/wasm-runtime';

const EXCEL_PARSE_WASM_URL = new URL('../../../wasm/excel-parse.wasm', import.meta.url);


let loadedInstance: Promise<WasmInstance> | null = null;

/** Loads the parser once. A failed load is forgotten, so the next file can retry. */
async function getExcelParser(): Promise<WasmInstance> {
  loadedInstance ??= compileWasmUrl(wasmModuleUrl(EXCEL_PARSE_WASM_URL, 'excel-parse.wasm'))
    .then((mod) => instantiateWasm(mod))
    .catch((error: unknown) => {
      loadedInstance = null;
      throw error;
    });
  return loadedInstance;
}

/**
 * Parses Excel files (.xlsx) using our Rust WebAssembly kernel
 * and returns normalized CSV text.
 */
export async function parseExcelToCsv(fileBytes: Uint8Array): Promise<string> {
  const instance = await getExcelParser();

  return instance.withBytes(fileBytes, (inPtr, inLen) => {
    const lenPtr = instance.alloc(4);
    try {
      let status = instance.fn('excel_parse_to_csv')(inPtr, inLen, 0, 0, lenPtr);
      const neededLen = new Uint32Array(instance.memory.buffer, lenPtr, 1)[0] ?? 0;

      if (neededLen === 0) {
        return '';
      }

      const outPtr = instance.alloc(neededLen);
      try {
        status = instance.fn('excel_parse_to_csv')(inPtr, inLen, outPtr, neededLen, lenPtr);
        checkStatus(status, 'excel_parse_to_csv');
        const csvBytes = instance.read(outPtr, neededLen);
        return new TextDecoder('utf-8').decode(csvBytes);
      } finally {
        instance.free(outPtr, neededLen);
      }
    } finally {
      instance.free(lenPtr, 4);
    }
  });
}
