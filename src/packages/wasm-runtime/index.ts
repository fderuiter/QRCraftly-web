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
 * Loads QRCraftly's Rust WebAssembly modules (#1182, ADR 0033).
 *
 * Modules are plain `extern "C"` exports over linear memory with no imports, so
 * they cannot reach the network, the DOM or the clock. Every module exports
 * `memory`, `alloc(len)`, `free(ptr, len)` and `abi_version()`; the helpers here
 * copy bytes in and out, free on every path and turn traps and status codes
 * into a typed {@link WasmModuleError}.
 *
 * Compile once per URL (cached), then instantiate inside the worker that uses
 * the module. A compiled `WebAssembly.Module` can also be posted to a worker.
 */

/** The shared calling convention, matching `crates/core/src/abi.rs`. */
export const ABI_VERSION = 1;

/** Status codes returned by fallible exports, matching `crates/core/src/abi.rs`. */
export const WASM_STATUS = {
  OK: 0,
  BAD_INPUT: 1,
  OUT_OF_MEMORY: 2,
  BUFFER_TOO_SMALL: 3,
} as const;

export type WasmErrorKind = 'origin' | 'fetch' | 'compile' | 'abi' | 'trap' | 'status' | 'memory';

export class WasmModuleError extends Error {
  readonly kind: WasmErrorKind;
  /** The status code, when `kind` is `status`. */
  readonly status: number | undefined;

  constructor(kind: WasmErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WasmModuleError';
    this.kind = kind;
    this.status = options.status;
  }
}

const STATUS_NAMES: Record<number, string> = {
  [WASM_STATUS.BAD_INPUT]: 'bad input',
  [WASM_STATUS.OUT_OF_MEMORY]: 'out of memory',
  [WASM_STATUS.BUFFER_TOO_SMALL]: 'output buffer too small',
};

/** Throws a typed error unless `status` is {@link WASM_STATUS.OK}. */
export function checkStatus(status: number, call: string): void {
  if (status === WASM_STATUS.OK) return;
  const name = STATUS_NAMES[status] ?? `status ${status}`;
  throw new WasmModuleError('status', `${call} failed: ${name}.`, { status });
}

/**
 * Resolves `url` against `base` and refuses anything not on the same origin.
 * Modules ship with the site, so another origin is always a mistake.
 */
export function resolveSameOrigin(url: string | URL, base: string | undefined = globalThis.location?.href): URL {
  if (!base) throw new WasmModuleError('origin', 'No page origin to load the WebAssembly module from.');
  const resolved = new URL(url, base);
  if (resolved.origin !== new URL(base).origin) {
    throw new WasmModuleError('origin', `Refusing to load a WebAssembly module from ${resolved.origin}.`);
  }
  return resolved;
}

/** Compiles module bytes. */
export async function compileWasmBytes(bytes: BufferSource): Promise<WebAssembly.Module> {
  try {
    return await WebAssembly.compile(bytes);
  } catch (cause) {
    throw new WasmModuleError('compile', 'The WebAssembly module did not compile.', { cause });
  }
}

const compiled = new Map<string, Promise<WebAssembly.Module>>();

async function fetchAndCompile(url: URL, fetchImpl: typeof fetch): Promise<WebAssembly.Module> {
  const response = await fetchImpl(url, { credentials: 'same-origin' });
  if (!response.ok) {
    // This literal also authorizes the fetch above in scripts/bundle_ast_audit.js.
    throw new WasmModuleError('fetch', 'wasm-runtime: same-origin module fetch failed with HTTP ' + String(response.status));
  }
  // Streaming compile needs the application/wasm type; fall back to bytes otherwise.
  if (typeof WebAssembly.compileStreaming === 'function' && response.headers.get('content-type') === 'application/wasm') {
    try {
      return await WebAssembly.compileStreaming(response);
    } catch (cause) {
      throw new WasmModuleError('compile', `${url.pathname} did not compile.`, { cause });
    }
  }
  return compileWasmBytes(await response.arrayBuffer());
}

/**
 * Fetches and compiles a module from the site's own origin, once per URL.
 * A failed load is not cached, so a later call can retry.
 */
export function compileWasmUrl(
  url: string | URL,
  options: { base?: string; fetchImpl?: typeof fetch } = {},
): Promise<WebAssembly.Module> {
  const resolved = resolveSameOrigin(url, options.base ?? globalThis.location?.href);
  const key = resolved.href;
  const cached = compiled.get(key);
  if (cached) return cached;
  const pending = fetchAndCompile(resolved, options.fetchImpl ?? fetch).catch((error: unknown) => {
    compiled.delete(key);
    throw error;
  });
  compiled.set(key, pending);
  return pending;
}

/** Forgets every compiled module. For tests. */
export function clearWasmCache(): void {
  compiled.clear();
}

type NumericFunction = (...args: number[]) => number;

function isTrap(error: unknown): boolean {
  return error instanceof WebAssembly.RuntimeError;
}

/** One instantiated module with typed helpers around its memory and exports. */
export class WasmInstance {
  readonly memory: WebAssembly.Memory;
  private readonly exportsByName: WebAssembly.Exports;
  private readonly allocFn: NumericFunction;
  private readonly freeFn: NumericFunction;

  constructor(instance: WebAssembly.Instance) {
    this.exportsByName = instance.exports;
    const memory = this.exportsByName.memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new WasmModuleError('abi', 'The module does not export its memory.');
    }
    this.memory = memory;
    this.allocFn = this.fn('alloc');
    this.freeFn = this.fn('free');
    const version = this.fn('abi_version')();
    if (version !== ABI_VERSION) {
      throw new WasmModuleError('abi', `The module speaks ABI ${version}; this loader speaks ${ABI_VERSION}.`);
    }
  }

  /**
   * A numeric export as a function. Integer results come back as signed 32-bit
   * values; use `>>> 0` for unsigned ones. A trap throws a {@link WasmModuleError}.
   */
  fn(name: string): NumericFunction {
    const target = this.exportsByName[name];
    if (typeof target !== 'function') {
      throw new WasmModuleError('abi', `The module has no "${name}" export.`);
    }
    return (...args: number[]): number => {
      try {
        return Number(Reflect.apply(target, undefined, args));
      } catch (cause) {
        if (isTrap(cause)) throw new WasmModuleError('trap', `${name} trapped.`, { cause });
        throw cause;
      }
    };
  }

  /** Reserves `len` bytes in the module and returns the address. */
  alloc(len: number): number {
    const ptr = this.allocFn(len);
    if (ptr === 0) throw new WasmModuleError('memory', `Could not allocate ${len} bytes in the module.`);
    return ptr;
  }

  free(ptr: number, len: number): void {
    this.freeFn(ptr, len);
  }

  /** Copies `bytes` into module memory at `ptr`. Views are rebuilt each call, so memory growth is safe. */
  write(ptr: number, bytes: Uint8Array): void {
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
  }

  /** Copies `len` bytes out of module memory. The result does not change if memory grows. */
  read(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.memory.buffer, ptr, len).slice();
  }

  /**
   * Copies `bytes` in, runs `fn` with their address and length, and frees them
   * afterwards, even when `fn` throws.
   */
  withBytes<T>(bytes: Uint8Array, fn: (ptr: number, len: number) => T): T {
    const len = bytes.length;
    const ptr = this.alloc(len);
    try {
      this.write(ptr, bytes);
      return fn(ptr, len);
    } finally {
      this.free(ptr, len);
    }
  }

  /**
   * Reserves an output buffer of `len` bytes, runs `fn` with it, then copies the
   * buffer out and frees it, even when `fn` throws.
   */
  withOutput(len: number, fn: (ptr: number, len: number) => void): Uint8Array {
    const ptr = this.alloc(len);
    try {
      fn(ptr, len);
      return this.read(ptr, len);
    } finally {
      this.free(ptr, len);
    }
  }
}

/** Instantiates a compiled module. Modules take no imports. */
export async function instantiateWasm(module: WebAssembly.Module): Promise<WasmInstance> {
  if (WebAssembly.Module.imports(module).length > 0) {
    throw new WasmModuleError('abi', 'QRCraftly modules must not import anything.');
  }
  const instance = await WebAssembly.instantiate(module, {});
  return new WasmInstance(instance);
}
