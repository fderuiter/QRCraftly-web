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

import {
  checkStatus,
  compileWasmUrl,
  instantiateWasmSync,
  WASM_STATUS,
  WasmModuleError,
  type WasmInstance,
} from '@/packages/wasm-runtime';
import { WalletPassError } from './errors';

export const WALLET_PASS_CRYPTO_WASM_URL = new URL('../../../wasm/wallet-pass-crypto.wasm', import.meta.url);

function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/wallet-pass-crypto.wasm', here) : WALLET_PASS_CRYPTO_WASM_URL;
}

let cachedInstance: WasmInstance | null = null;
let asyncLoadingPromise: Promise<WasmInstance> | null = null;

function nodeReadFileSync(url: URL): Uint8Array | null {
  const proc: unknown = Reflect.get(globalThis, 'process');
  if (typeof proc !== 'object' || proc === null) return null;
  const getBuiltinModule: unknown = Reflect.get(proc, 'getBuiltinModule');
  if (typeof getBuiltinModule !== 'function') return null;
  const fs: unknown = Reflect.apply(getBuiltinModule, proc, ['node:fs']);
  if (typeof fs !== 'object' || fs === null) return null;
  const readFileSync: unknown = Reflect.get(fs, 'readFileSync');
  if (typeof readFileSync !== 'function') return null;
  for (const arg of [url, url.pathname, url.href]) {
    try {
      const bytes: unknown = Reflect.apply(readFileSync, fs, [arg]);
      if (ArrayBuffer.isView(bytes)) {
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      }
    } catch {
      // try next
    }
  }
  return null;
}

export function getWalletPassCryptoSync(): WasmInstance {
  if (cachedInstance) return cachedInstance;
  const url = moduleUrl();
  const fileBytes = nodeReadFileSync(url);
  if (fileBytes) {
    const mod = new WebAssembly.Module(fileBytes);
    cachedInstance = instantiateWasmSync(mod);
    return cachedInstance;
  }
  throw new WalletPassError('Wallet pass WebAssembly module must be loaded before calling synchronous methods.');
}

export async function loadWalletPassCrypto(): Promise<WasmInstance> {
  if (cachedInstance) return cachedInstance;
  if (!asyncLoadingPromise) {
    const url = moduleUrl();
    const fileBytes = nodeReadFileSync(url);
    if (fileBytes) {
      const mod = new WebAssembly.Module(fileBytes);
      cachedInstance = instantiateWasmSync(mod);
      return cachedInstance;
    }
    asyncLoadingPromise = compileWasmUrl(url)
      .then((mod) => {
        cachedInstance = instantiateWasmSync(mod);
        return cachedInstance;
      })
      .catch((error: unknown) => {
        asyncLoadingPromise = null;
        throw error instanceof WasmModuleError
          ? error
          : new WasmModuleError('compile', 'The wallet pass crypto module did not load.', { cause: error });
      });
  }
  return asyncLoadingPromise;
}

/** Converts PEM text to PKCS#8 DER bytes inside WASM memory. */
export function wasmPrivateKeyToPkcs8(text: string): Uint8Array {
  const instance = getWalletPassCryptoSync();
  const encoder = new TextEncoder();
  const pemBytes = encoder.encode(text);

  try {
    return instance.withBytes(pemBytes, (pemPtr, pemLen) => {
      const lenBuf = instance.alloc(4);
      let actualLen = 0;
      try {
        const st = instance.fn('wallet_pass_pem_to_pkcs8')(pemPtr, pemLen, 0, 0, lenBuf);
        if (st === WASM_STATUS.BAD_INPUT) {
          if (text.includes('ENCRYPTED PRIVATE KEY') || /Proc-Type: 4,ENCRYPTED/.test(text)) {
            throw new WalletPassError(
              'This private key is protected with a password. Export it without one, for example with "openssl pkey -in key.pem -out key-plain.pem".'
            );
          }
          if (text.includes('RSA PRIVATE KEY') || text.includes('PRIVATE KEY')) {
            throw new WalletPassError('The RSA private key is damaged.');
          }
          throw new WalletPassError('No private key was found. Choose a PEM file that contains "BEGIN PRIVATE KEY".');
        }
        const lenView = instance.read(lenBuf, 4);
        actualLen = new DataView(lenView.buffer, lenView.byteOffset, lenView.byteLength).getUint32(0, true);
      } finally {
        instance.free(lenBuf, 4);
      }

      if (actualLen === 0) {
        throw new WalletPassError('No private key was found. Choose a PEM file that contains "BEGIN PRIVATE KEY".');
      }

      return instance.withOutput(actualLen, (outPtr, outMax) => {
        const lenBuf2 = instance.alloc(4);
        try {
          const st = instance.fn('wallet_pass_pem_to_pkcs8')(pemPtr, pemLen, outPtr, outMax, lenBuf2);
          checkStatus(st, 'wallet_pass_pem_to_pkcs8');
        } finally {
          instance.free(lenBuf2, 4);
        }
      });
    });
  } finally {
    pemBytes.fill(0);
  }
}

/** Calculates RSASSA-PKCS1-v1_5 SHA-256 signature using WASM. */
export async function wasmRsaSign(keyPem: string, data: Uint8Array): Promise<Uint8Array> {
  const instance = await loadWalletPassCrypto();
  const encoder = new TextEncoder();
  const pemBytes = encoder.encode(keyPem);

  try {
    return instance.withBytes(pemBytes, (keyPtr, keyLen) => {
      return instance.withBytes(data, (dataPtr, dataLen) => {
        const lenBuf = instance.alloc(4);
        let sigLen = 0;
        try {
          const st = instance.fn('wallet_pass_rsa_sign')(keyPtr, keyLen, dataPtr, dataLen, 0, 0, lenBuf);
          if (st === WASM_STATUS.BAD_INPUT) {
            if (keyPem.includes('ENCRYPTED PRIVATE KEY') || /Proc-Type: 4,ENCRYPTED/.test(keyPem)) {
              throw new WalletPassError(
                'This private key is protected with a password. Export it without one, for example with "openssl pkey -in key.pem -out key-plain.pem".'
              );
            }
            if (keyPem.includes('RSA PRIVATE KEY') || keyPem.includes('PRIVATE KEY')) {
              throw new WalletPassError('This private key could not be loaded. Use an RSA private key in PEM form.');
            }
            throw new WalletPassError('No private key was found. Choose a PEM file that contains "BEGIN PRIVATE KEY".');
          }
          const view = instance.read(lenBuf, 4);
          sigLen = new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(0, true);
        } finally {
          instance.free(lenBuf, 4);
        }

        if (sigLen === 0) {
          throw new WalletPassError('This private key could not be loaded. Use an RSA private key in PEM form.');
        }

        return instance.withOutput(sigLen, (outPtr, outMax) => {
          const lenBuf2 = instance.alloc(4);
          try {
            const st = instance.fn('wallet_pass_rsa_sign')(keyPtr, keyLen, dataPtr, dataLen, outPtr, outMax, lenBuf2);
            checkStatus(st, 'wallet_pass_rsa_sign');
          } finally {
            instance.free(lenBuf2, 4);
          }
        });
      });
    });
  } finally {
    pemBytes.fill(0);
  }
}

/** Signs detached CMS ContentInfo DER for Apple .pkpass using WASM. */
export async function wasmCmsSign(
  content: Uint8Array,
  signerDer: Uint8Array,
  chainDers: readonly Uint8Array[],
  keyPem: string,
  signingTime: Date
): Promise<Uint8Array> {
  const instance = await loadWalletPassCrypto();
  const encoder = new TextEncoder();
  const pemBytes = encoder.encode(keyPem);

  let totalChainLen = 0;
  for (const c of chainDers) totalChainLen += 4 + c.length;
  const chainBuf = new Uint8Array(totalChainLen);
  let chainOffset = 0;
  const view = new DataView(chainBuf.buffer);
  for (const c of chainDers) {
    view.setUint32(chainOffset, c.length, false);
    chainOffset += 4;
    chainBuf.set(c, chainOffset);
    chainOffset += c.length;
  }

  const timeSec = Math.floor(signingTime.getTime() / 1000);

  try {
    return instance.withBytes(pemBytes, (keyPtr, keyLen) => {
      return instance.withBytes(content, (contentPtr, contentLen) => {
        return instance.withBytes(signerDer, (signerPtr, signerLen) => {
          return instance.withBytes(chainBuf, (chainPtr, chainLen) => {
            const lenBuf = instance.alloc(4);
            let cmsLen = 0;
            try {
              const st = instance.fn('wallet_pass_cms_sign')(
                contentPtr,
                contentLen,
                signerPtr,
                signerLen,
                chainPtr,
                chainLen,
                chainDers.length,
                keyPtr,
                keyLen,
                timeSec,
                0,
                0,
                lenBuf
              );
              if (st === WASM_STATUS.BAD_INPUT) {
                throw new WalletPassError('Could not build CMS signature with provided key and certificates.');
              }
              const lenView = instance.read(lenBuf, 4);
              cmsLen = new DataView(lenView.buffer, lenView.byteOffset, lenView.byteLength).getUint32(0, true);
            } finally {
              instance.free(lenBuf, 4);
            }

            return instance.withOutput(cmsLen, (outPtr, outMax) => {
              const lenBuf2 = instance.alloc(4);
              try {
                const st = instance.fn('wallet_pass_cms_sign')(
                  contentPtr,
                  contentLen,
                  signerPtr,
                  signerLen,
                  chainPtr,
                  chainLen,
                  chainDers.length,
                  keyPtr,
                  keyLen,
                  timeSec,
                  outPtr,
                  outMax,
                  lenBuf2
                );
                checkStatus(st, 'wallet_pass_cms_sign');
              } finally {
                instance.free(lenBuf2, 4);
              }
            });
          });
        });
      });
    });
  } finally {
    pemBytes.fill(0);
    chainBuf.fill(0);
  }
}

/** Parses certificates from a file buffer using WASM. */
export function wasmCertificatesFromFile(fileBytes: Uint8Array): Uint8Array[] {
  const instance = getWalletPassCryptoSync();

  return instance.withBytes(fileBytes, (filePtr, fileLen) => {
    const lenBuf = instance.alloc(4);
    let totalLen = 0;
    try {
      const st = instance.fn('wallet_pass_certificates_from_file')(filePtr, fileLen, 0, 0, lenBuf);
      if (st === WASM_STATUS.BAD_INPUT) return [];
      const lenView = instance.read(lenBuf, 4);
      totalLen = new DataView(lenView.buffer, lenView.byteOffset, lenView.byteLength).getUint32(0, true);
    } finally {
      instance.free(lenBuf, 4);
    }

    if (totalLen === 0) return [];

    const packed = instance.withOutput(totalLen, (outPtr, outMax) => {
      const lenBuf2 = instance.alloc(4);
      try {
        const st = instance.fn('wallet_pass_certificates_from_file')(filePtr, fileLen, outPtr, outMax, lenBuf2);
        checkStatus(st, 'wallet_pass_certificates_from_file');
      } finally {
        instance.free(lenBuf2, 4);
      }
    });

    const certs: Uint8Array[] = [];
    let offset = 0;
    const packedView = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    while (offset + 4 <= packed.length) {
      const certLen = packedView.getUint32(offset, false);
      offset += 4;
      if (offset + certLen <= packed.length) {
        certs.push(packed.subarray(offset, offset + certLen));
        offset += certLen;
      } else {
        break;
      }
    }
    return certs;
  });
}
