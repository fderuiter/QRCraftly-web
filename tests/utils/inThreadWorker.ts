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

/**
 * Runs the real worker modules on the test thread (#983).
 *
 * Neither jsdom nor Node gives Vitest real module Web Workers, so tests used to
 * re-implement each worker inside a mock. `InThreadWorker` instead imports the
 * worker file named by `new Worker(new URL('./x.ts', import.meta.url))` and
 * exchanges messages with it through a fake worker global scope:
 *
 * - The module's free `self` resolves to that scope while the worker's own code
 *   runs. `self` is a getter on `globalThis` backed by `AsyncLocalStorage`, so a
 *   handler still posts to the right worker after an `await`, and several
 *   workers can be alive at once.
 * - `worker.postMessage` checks that the payload is structured-cloneable and
 *   delivers it to the scope's `onmessage` / `message` listeners on a later
 *   macrotask, like a real worker. `self.postMessage` delivers back the same way.
 * - Uncaught errors in the worker's handler reach `worker.onerror`.
 *
 * Nothing is keyed to a particular file: any worker URL works, so workers can
 * move between folders without touching this harness.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Listener = (event: MessageEvent | ErrorEvent) => unknown;

/** The global scope a worker module sees as `self`. */
export interface InThreadWorkerScope {
  onmessage: ((event: MessageEvent) => unknown) | null;
  onmessageerror: ((event: MessageEvent) => unknown) | null;
  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  close(): void;
  [key: string]: unknown;
}

/** Handlers a worker module registered on its scope while it was evaluated. */
interface Registration {
  onmessage: InThreadWorkerScope['onmessage'];
  listeners: Map<string, Set<Listener>>;
}

const currentScope = new AsyncLocalStorage<InThreadWorkerScope>();

let installed = false;
let fallbackSelf: unknown;

/**
 * Makes the global `self` resolve to the running worker's scope, and to the
 * environment's own `self` (the jsdom window, or `globalThis` in Node) otherwise.
 */
function installSelfGetter(): void {
  if (installed) return;
  installed = true;
  fallbackSelf = (globalThis as { self?: unknown }).self ?? globalThis;
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    get: () => currentScope.getStore() ?? fallbackSelf,
    set: (value: unknown) => {
      fallbackSelf = value;
    },
  });
}

/** Handlers registered by the first evaluation of each worker module, keyed by file path. */
const registrations = new Map<string, Registration>();
let instanceCounter = 0;

/**
 * Throws a `DataCloneError` for payloads a real `postMessage` rejects. Beyond
 * `structuredClone`, jsdom DOM nodes are rejected explicitly because jsdom's
 * nodes are plain objects that `structuredClone` would happily copy.
 */
export function assertStructuredCloneable(value: unknown, seen: Set<unknown> = new Set()): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'function') throw new DOMException('Functions cannot be cloned', 'DataCloneError');
  if (typeof value === 'symbol') throw new DOMException('Symbols cannot be cloned', 'DataCloneError');
  if (typeof value !== 'object' || seen.has(value)) return;
  const node = value as { nodeType?: unknown; ownerDocument?: { defaultView?: unknown } };
  if (
    (typeof Element !== 'undefined' && value instanceof Element) ||
    node.nodeType !== undefined ||
    node.ownerDocument?.defaultView
  ) {
    throw new DOMException('DOM elements cannot be cloned', 'DataCloneError');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertStructuredCloneable(item, seen));
  } else if (Object.prototype.toString.call(value) === '[object Object]') {
    Object.values(value).forEach((item) => assertStructuredCloneable(item, seen));
  }
}

/** Resolves what `new Worker(url)` was given to a module path Vitest can import, or null. */
export function resolveWorkerModulePath(url: string | URL): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url instanceof URL ? url.href : String(url));
  } catch {
    return null;
  }
  let modulePath: string;
  if (parsed.protocol === 'file:') {
    modulePath = fileURLToPath(new URL(parsed.pathname, 'file://'));
  } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    // Vite rewrites `new Worker(new URL(...))` to a dev-server URL such as
    // `/src/x/worker.ts?worker_file&type=module` (or `/@fs/<absolute path>`).
    const pathname = decodeURIComponent(parsed.pathname);
    modulePath = pathname.startsWith('/@fs/')
      ? pathname.slice('/@fs'.length)
      : path.join(process.cwd(), pathname);
  } else {
    return null;
  }
  return existsSync(modulePath) ? modulePath : null;
}

const nextTask = (fn: () => void) => setTimeout(fn, 0);

/**
 * A `Worker` whose module runs on the current thread. Messages cross a macrotask
 * boundary in both directions, as they do between real threads.
 */
export class InThreadWorker {
  public terminated = false;
  public onmessage: ((event: MessageEvent) => unknown) | null = null;
  public onmessageerror: ((event: MessageEvent) => unknown) | null = null;
  public onerror: ((event: ErrorEvent) => unknown) | null = null;
  /** Resolves once the worker module has been evaluated (or failed to load). */
  public readonly ready: Promise<void>;
  /** The fake global scope the worker module runs against. */
  public readonly scope: InThreadWorkerScope;

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly scopeListeners = new Map<string, Set<Listener>>();
  /** Why the worker module could not be loaded, if it could not. */
  public loadError: unknown = null;

  public readonly url: string | URL;
  public readonly options?: WorkerOptions;

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    installSelfGetter();
    this.scope = this.createScope();
    this.ready = this.load();
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Sends a message to the worker module. Throws synchronously for uncloneable payloads. */
  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
    if (this.terminated) return;
    assertStructuredCloneable(message);
    structuredClone(message);
    void transfer;
    nextTask(() => {
      void this.deliverToWorker(message);
    });
  }

  /**
   * Delivers a message to the worker module now and resolves when its handler
   * settles. Used by harnesses that schedule delivery themselves.
   */
  async deliverToWorker(message: unknown): Promise<void> {
    await this.ready;
    if (this.terminated) return;
    if (this.loadError) {
      this.dispatchToMain('error', this.loadError);
      return;
    }
    const event = { data: message, type: 'message', target: this.scope } as unknown as MessageEvent;
    const handlers: Listener[] = [...(this.scopeListeners.get('message') ?? [])];
    if (typeof this.scope.onmessage === 'function') handlers.push(this.scope.onmessage as Listener);
    await currentScope.run(this.scope, async () => {
      await Promise.all(
        handlers.map(async (handler) => {
          try {
            await handler(event);
          } catch (error) {
            this.dispatchToMain('error', error);
          }
        }),
      );
    });
  }

  /** Dispatches a message event to the main-thread side, as if the worker had posted it. */
  dispatchMessage(data: unknown): void {
    this.dispatchToMain('message', data);
  }

  /** Dispatches an error event to the main-thread side, as if the worker had thrown. */
  dispatchError(error: unknown): void {
    this.dispatchToMain('error', error);
  }

  private dispatchToMain(type: 'message' | 'error', payload: unknown): void {
    if (this.terminated) return;
    const event =
      type === 'message'
        ? ({ data: payload, type, target: this } as unknown as MessageEvent)
        : ({
            error: payload,
            message: payload instanceof Error ? payload.message : String(payload),
            type,
            target: this,
            preventDefault: () => {},
          } as unknown as ErrorEvent);
    currentScope.exit(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        try {
          listener(event);
        } catch (error) {
          console.error(error);
        }
      }
      const handler = type === 'message' ? this.onmessage : this.onerror;
      if (typeof handler === 'function') {
        try {
          (handler as Listener).call(this, event);
        } catch (error) {
          console.error(error);
        }
      }
    });
  }

  private createScope(): InThreadWorkerScope {
    const own: InThreadWorkerScope = {
      onmessage: null,
      onmessageerror: null,
      postMessage: (message: unknown) => {
        if (this.terminated) return;
        assertStructuredCloneable(message);
        nextTask(() => this.dispatchToMain('message', message));
      },
      addEventListener: (type: string, listener: Listener) => {
        if (!this.scopeListeners.has(type)) this.scopeListeners.set(type, new Set());
        this.scopeListeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        this.scopeListeners.get(type)?.delete(listener);
      },
      close: () => {
        this.terminated = true;
      },
    };
    // Anything else a worker reads from `self` (crypto, setTimeout, OffscreenCanvas...) comes from the global.
    return new Proxy(own, {
      get: (target, key, receiver) =>
        key in target ? Reflect.get(target, key, receiver) : Reflect.get(globalThis, key),
      has: (target, key) => key in target || key in globalThis,
    });
  }

  private async load(): Promise<void> {
    const modulePath = resolveWorkerModulePath(this.url);
    if (!modulePath) {
      this.loadError = new Error(`InThreadWorker cannot find the worker module for: ${String(this.url)}`);
      return;
    }
    try {
      // A fresh module instance per worker, so module-level state is per worker as it is in a browser.
      instanceCounter += 1;
      const specifier = `${modulePath}?in-thread-worker=${instanceCounter}`;
      await currentScope.run(this.scope, () => import(/* @vite-ignore */ specifier));
    } catch (error) {
      this.loadError = error;
      return;
    }
    const registered =
      typeof this.scope.onmessage === 'function' || (this.scopeListeners.get('message')?.size ?? 0) > 0;
    if (registered) {
      if (!registrations.has(modulePath)) {
        registrations.set(modulePath, {
          onmessage: this.scope.onmessage,
          listeners: new Map([...this.scopeListeners].map(([type, set]) => [type, new Set(set)])),
        });
      }
      return;
    }
    // The entry re-exports a module that was already evaluated for an earlier worker
    // (for example `worker.ts` importing `./lib/worker`); reuse the handlers it registered.
    const previous = registrations.get(modulePath);
    if (previous) {
      this.scope.onmessage = previous.onmessage;
      for (const [type, set] of previous.listeners) this.scopeListeners.set(type, new Set(set));
      return;
    }
    this.loadError = new Error(`Worker module ${modulePath} registered no message handler`);
  }
}

/** A worker module loaded in-thread, for tests that drive its message handler directly. */
export interface WorkerModuleUnderTest {
  /** The worker's `self`. Replace `scope.postMessage` with a spy to capture what the worker posts. */
  scope: InThreadWorkerScope;
  /** Calls the module's `self.onmessage` as the worker runtime would and resolves when it settles. */
  handle(event: { data: unknown }): Promise<void>;
}

/**
 * Loads a worker module (by the same URL the app passes to `new Worker`) with its own
 * `self`, without touching the test environment's globals.
 */
export async function loadWorkerModule(url: URL): Promise<WorkerModuleUnderTest> {
  const worker = new InThreadWorker(url);
  await worker.ready;
  if (worker.loadError) throw worker.loadError;
  const { scope } = worker;
  return {
    scope,
    handle: (event) =>
      currentScope.run(scope, async () => {
        await scope.onmessage?.(event as MessageEvent);
      }),
  };
}
