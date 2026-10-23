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

import { instantiateWasmSync, type WasmInstance } from '@/packages/wasm-runtime';

export type AddressCheck =
  /** The checksum matched. */
  | 'valid'
  /** The address is malformed or its checksum does not match. */
  | 'invalid'
  /** The format has no checksum to check (an all-lower-case Ethereum address, a Solana key). */
  | 'unchecked';

function nodeReadWasmFile(url: URL): Uint8Array | null {
  const proc: unknown = Reflect.get(globalThis, 'process');
  if (typeof proc !== 'object' || proc === null) return null;
  const getBuiltinModule: unknown = Reflect.get(proc, 'getBuiltinModule');
  if (typeof getBuiltinModule !== 'function') return null;
  const fs: unknown = Reflect.apply(getBuiltinModule, proc, ['node:fs']);
  if (typeof fs !== 'object' || fs === null) return null;
  const readFileSync: unknown = Reflect.get(fs, 'readFileSync');
  if (typeof readFileSync !== 'function') return null;
  const bytes: unknown = Reflect.apply(readFileSync, fs, [url]);
  if (!ArrayBuffer.isView(bytes)) return null;
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

let wasmInstanceCache: WasmInstance | null = null;

export function getCryptoWasmInstance(): WasmInstance | null {
  if (wasmInstanceCache) return wasmInstanceCache;
  try {
    const here = import.meta.url;
    if (here.startsWith('file:')) {
      const wasmUrl = new URL('../wasm/crypto.wasm', here);
      const bytes = nodeReadWasmFile(wasmUrl);
      if (bytes) {
        const module = new WebAssembly.Module(bytes);
        wasmInstanceCache = instantiateWasmSync(module);
        return wasmInstanceCache;
      }
    }
  } catch {
    // Fall back to pure JS if sync WASM load fails
  }
  return null;
}

export function validateAddressWasm(network: string, address: string): AddressCheck | null {
  const instance = getCryptoWasmInstance();
  if (!instance) return null;
  const validateFn = instance.fn('crypto_validate_address');
  const encoder = new TextEncoder();
  const netBytes = encoder.encode(network);
  const addrBytes = encoder.encode(address);

  const res = instance.withBytes(netBytes, (netPtr, netLen) => {
    return instance.withBytes(addrBytes, (addrPtr, addrLen) => {
      return validateFn(netPtr, netLen, addrPtr, addrLen);
    });
  });

  if (res === 0) return 'valid';
  if (res === 1) return 'invalid';
  if (res === 2) return 'unchecked';
  return null;
}

export function sha256Wasm(message: Uint8Array): Uint8Array | null {
  const instance = getCryptoWasmInstance();
  if (!instance) return null;
  const sha256Fn = instance.fn('crypto_sha256');
  return instance.withBytes(message, (inPtr, inLen) => {
    return instance.withOutput(32, (outPtr, outLen) => {
      const status = sha256Fn(inPtr, inLen, outPtr, outLen);
      if (status !== 0) throw new Error(`crypto_sha256 failed with status ${status}`);
    });
  });
}

export function keccak256Wasm(message: Uint8Array): Uint8Array | null {
  const instance = getCryptoWasmInstance();
  if (!instance) return null;
  const keccakFn = instance.fn('crypto_keccak256');
  return instance.withBytes(message, (inPtr, inLen) => {
    return instance.withOutput(32, (outPtr, outLen) => {
      const status = keccakFn(inPtr, inLen, outPtr, outLen);
      if (status !== 0) throw new Error(`crypto_keccak256 failed with status ${status}`);
    });
  });
}
