import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { QRConfig } from '@/types';
import { DEFAULT_CONFIG } from '@/constants';
import { sanitizeConfig } from '@/packages/qr-payload';

/**
 * Payload of the `scannability-fail` signal. It stays in memory on this device and only
 * carries non-sensitive diagnostic fields, never QR content.
 */
interface ScannabilityFailDetail {
  /** Decoder engine that reported the failure. */
  engine?: string;
  /** QR style in use. */
  styleId?: string;
  /** Failure classification. */
  errorType?: string;
}

/**
 * Signal names mapped to their payload types.
 */
interface SignalPayloads {
  'scannability-fail': ScannabilityFailDetail;
}

type SignalName = keyof SignalPayloads;
type SignalCallback<N extends SignalName> = (detail: SignalPayloads[N]) => void;

/**
 * Snapshot held by a QR store.
 */
export type QRState = {
  /** Sanitised QR configuration. */
  config: QRConfig;
  /** Module count of the last rendered matrix. */
  moduleCount: number;
  /**
   * Whether scannability fallback mode is active. The store is its single owner: it is set
   * by the `scannability-fail` signal and reset only when content (type/value) or the
   * error correction level changes.
   */
  isScannabilityFallbackActive: boolean;
  /**
   * Whether the content form holds a value it refuses to encode. The config then keeps the last
   * accepted content, so the preview and exports must not use it until the field is fixed (#1279).
   */
  contentRefused: boolean;
  /** Whether an appearance change can be undone. */
  canUndo: boolean;
  /** Whether an undone appearance change can be redone. */
  canRedo: boolean;
};

/** Options for {@link QRStore.updateConfig}. */
export interface UpdateConfigOptions {
  /**
   * `push` (default) records an appearance change as an undo step; `skip` applies it without a
   * step, for example a hover preview.
   */
  history?: 'push' | 'skip';
}

/**
 * External store API for one generator instance.
 */
export interface QRStore {
  /** Returns the current snapshot. */
  getState: () => QRState;
  /** Subscribes to changes; returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  /**
   * Merges, sanitises and applies config updates. No-op updates do not notify. Changes to
   * appearance fields become undo steps; content changes (type, value, text) never do.
   */
  updateConfig: (updates: Partial<QRConfig>, options?: UpdateConfigOptions) => void;
  /** Undoes the last appearance change. Returns whether anything changed. */
  undo: () => boolean;
  /** Redoes the last undone appearance change. Returns whether anything changed. */
  redo: () => boolean;
  /**
   * Shows appearance updates temporarily (a hover or focus preview) without an undo step.
   * Pass null to restore what was showing before the preview.
   */
  preview: (updates: Partial<QRConfig> | null) => void;
  /** Records the rendered matrix module count. */
  setModuleCount: (count: number) => void;
  /** Sets the scannability fallback flag. */
  setScannabilityFallbackActive: (active: boolean) => void;
  /** Records whether the content form holds a refused value. */
  setContentRefused: (refused: boolean) => void;
  /** Emits a typed signal. */
  emitSignal: <N extends SignalName>(name: N, detail: SignalPayloads[N]) => void;
  /** Registers a typed signal callback; returns an unregister function. */
  registerSignal: <N extends SignalName>(name: N, callback: SignalCallback<N>) => () => void;
}

const QRStoreContext = createContext<QRStore | undefined>(undefined);

/** Config fields whose change invalidates a scannability fallback decision. */
const FALLBACK_RESET_FIELDS: ReadonlyArray<keyof QRConfig> = ['type', 'value', 'errorCorrectionLevel'];

function shallowEqualConfig(a: QRConfig, b: QRConfig): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof QRConfig)[]);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Fields that carry QR content or free text a visitor typed. They are never retained
 * across routes; each generator route starts with its own content.
 */
const NON_RETAINED_FIELDS: ReadonlySet<keyof QRConfig> = new Set<keyof QRConfig>([
  'type',
  'value',
  'animationValues',
  'isAnimating',
  'borderText',
  'templateHeadline',
  'templateSubtext',
]);

/**
 * Appearance-only settings kept in volatile module memory so they survive client-side
 * navigation between generator routes. Never persisted: a reload or new tab starts fresh.
 */
let retainedAppearance: Partial<QRConfig> | null = null;

function pickAppearance(config: QRConfig): Partial<QRConfig> {
  const appearance: Partial<QRConfig> = {};
  for (const key of Object.keys(config) as (keyof QRConfig)[]) {
    if (!NON_RETAINED_FIELDS.has(key)) {
      (appearance as Record<string, unknown>)[key] = config[key];
    }
  }
  return appearance;
}

/**
 * Forgets appearance retained from earlier generator routes.
 */
export function clearRetainedAppearance(): void {
  retainedAppearance = null;
}

/**
 * Content a scan asked to open in the generator (#1101), kept in volatile module memory for
 * the client-side navigation to the generator route. Never persisted or put in the URL.
 */
let stagedContent: Pick<QRConfig, 'type' | 'value'> | null = null;

/**
 * Hands scanned content to the next generator route that opens for its type.
 * @param content - The QR type and the raw content.
 */
export function stageGeneratorContent(content: Pick<QRConfig, 'type' | 'value'>): void {
  stagedContent = { ...content };
}

/** Staged content for a generator route of this type, or null. */
function stagedContentFor(type: QRConfig['type'] | undefined): Pick<QRConfig, 'type' | 'value'> | null {
  return stagedContent && stagedContent.type === type ? stagedContent : null;
}

/** Most undo steps kept per generator. */
export const MAX_HISTORY_STEPS = 50;
/** Changes to the same fields within this window merge into one undo step (slider drags, typing a colour). */
const COALESCE_MS = 600;

function sameAppearance(a: Partial<QRConfig>, b: Partial<QRConfig>): boolean {
  const keys = Object.keys(a) as (keyof QRConfig)[];
  return keys.every(key => Object.is(a[key], b[key]));
}

function createQRStore(initialConfig?: Partial<QRConfig>, retainAppearance = false, presetConfig?: Partial<QRConfig>): QRStore {
  let state: QRState = {
    config: {
      ...DEFAULT_CONFIG,
      ...initialConfig,
      ...(retainAppearance ? retainedAppearance : null),
      ...presetConfig,
      ...(retainAppearance ? stagedContentFor(initialConfig?.type ?? DEFAULT_CONFIG.type) : null),
    },
    moduleCount: 0,
    isScannabilityFallbackActive: false,
    contentRefused: false,
    canUndo: false,
    canRedo: false,
  };

  // Undo history holds appearance snapshots in memory only (never persisted).
  let past: Partial<QRConfig>[] = [];
  let future: Partial<QRConfig>[] = [];
  let lastPush: { keys: string; at: number } | null = null;
  let previewBase: Partial<QRConfig> | null = null;

  const listeners = new Set<() => void>();
  const signals: { [N in SignalName]: Set<SignalCallback<N>> } = {
    'scannability-fail': new Set(),
  };

  const setState = (next: QRState) => {
    state = next;
    listeners.forEach(l => l());
  };

  const store: QRStore = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateConfig: (updates, options) => {
      const sanitized = sanitizeConfig({ ...state.config, ...updates });
      if (shallowEqualConfig(sanitized, state.config)) return;
      const before = pickAppearance(state.config);
      const after = pickAppearance(sanitized);
      const appearanceChanged = !sameAppearance(before, after);
      const recording = appearanceChanged && options?.history !== 'skip' && previewBase === null;
      if (recording) {
        const keys = Object.keys(updates).sort().join(',');
        const now = Date.now();
        const coalesce = lastPush !== null && lastPush.keys === keys && now - lastPush.at < COALESCE_MS && past.length > 0;
        if (!coalesce) {
          past = [...past.slice(-(MAX_HISTORY_STEPS - 1)), before];
        }
        lastPush = { keys, at: now };
        future = [];
      }
      if (retainAppearance && previewBase === null) retainedAppearance = after;
      const resetsFallback = FALLBACK_RESET_FIELDS.some(key => !Object.is(sanitized[key], state.config[key]));
      setState({
        ...state,
        config: sanitized,
        isScannabilityFallbackActive: resetsFallback ? false : state.isScannabilityFallbackActive,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
      });
    },
    undo: () => {
      const target = past[past.length - 1];
      if (!target) return false;
      past = past.slice(0, -1);
      future = [...future, pickAppearance(state.config)];
      lastPush = null;
      const sanitized = sanitizeConfig({ ...state.config, ...target });
      if (retainAppearance) retainedAppearance = pickAppearance(sanitized);
      setState({ ...state, config: sanitized, canUndo: past.length > 0, canRedo: true });
      return true;
    },
    redo: () => {
      const target = future[future.length - 1];
      if (!target) return false;
      future = future.slice(0, -1);
      past = [...past, pickAppearance(state.config)];
      lastPush = null;
      const sanitized = sanitizeConfig({ ...state.config, ...target });
      if (retainAppearance) retainedAppearance = pickAppearance(sanitized);
      setState({ ...state, config: sanitized, canUndo: true, canRedo: future.length > 0 });
      return true;
    },
    preview: (updates) => {
      if (updates === null) {
        if (previewBase === null) return;
        const base = previewBase;
        previewBase = null;
        const restored = sanitizeConfig({ ...state.config, ...base });
        if (!shallowEqualConfig(restored, state.config)) setState({ ...state, config: restored });
        return;
      }
      const sanitized = sanitizeConfig({ ...state.config, ...updates });
      if (shallowEqualConfig(sanitized, state.config)) return;
      previewBase ??= pickAppearance(state.config);
      setState({ ...state, config: sanitized });
    },
    setScannabilityFallbackActive: (active) => {
      if (state.isScannabilityFallbackActive !== active) {
        setState({ ...state, isScannabilityFallbackActive: active });
      }
    },
    setContentRefused: (refused) => {
      if (state.contentRefused !== refused) {
        setState({ ...state, contentRefused: refused });
      }
    },
    setModuleCount: (count) => {
      if (state.moduleCount !== count) {
        setState({ ...state, moduleCount: count });
      }
    },
    emitSignal: (name, detail) => {
      signals[name].forEach(cb => cb(detail));
    },
    registerSignal: (name, callback) => {
      const set = signals[name];
      set.add(callback);
      return () => {
        set.delete(callback);
      };
    }
  };

  // Scannability failures switch the store (the single owner) into fallback mode.
  store.registerSignal('scannability-fail', () => {
    store.setScannabilityFallbackActive(true);
  });

  return store;
}

/**
 * Provides one QR store to a generator instance.
 * @param root0 - Component properties.
 * @param root0.children - The generator tree.
 * @param root0.initialConfig - Route-specific initial configuration (for example the QR type).
 * @param root0.retainAppearance - Carry appearance-only settings (never content) over from the
 *   previous generator route, in memory only.
 * @param root0.presetConfig - Settings a landing page asks for (for example high error correction);
 *   they win over appearance retained from earlier routes.
 * @returns The provider element.
 */
export const QRProvider = ({ children, initialConfig, retainAppearance = false, presetConfig }: { children: React.ReactNode, initialConfig?: Partial<QRConfig>, retainAppearance?: boolean, presetConfig?: Partial<QRConfig> }) => {
  const [store] = useState(() => createQRStore(initialConfig, retainAppearance, presetConfig));

  // Staged content is read once: clear it after the first generator mounts with it. (Clearing
  // here, not in the state initialiser, keeps StrictMode's double initialiser call safe.)
  useEffect(() => {
    if (retainAppearance && stagedContentFor(store.getState().config.type)) stagedContent = null;
  }, [store, retainAppearance]);

  return (
    <QRStoreContext.Provider value={store}>
      {children}
    </QRStoreContext.Provider>
  );
};

const noopSubscribe = () => () => {};

/**
 * Selects a slice of the nearest QR store, or undefined outside a `QRProvider`.
 * Selectors should return primitives or stable references to avoid extra renders.
 * @param selector - Picks the slice a consumer needs.
 * @returns The selected slice, or undefined without a provider.
 */
export function useOptionalQRStoreSelector<T>(selector: (state: QRState) => T): T | undefined {
  const store = useContext(QRStoreContext);
  
  const subscribe = store ? store.subscribe : noopSubscribe;
  const getSnapshot = () => store ? selector(store.getState()) : undefined;
  
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  );
}

/**
 * Selects a slice of the nearest QR store. Throws outside a `QRProvider`.
 * @param selector - Picks the slice a consumer needs.
 * @returns The selected slice.
 */
export function useQRStoreSelector<T>(selector: (state: QRState) => T): T {
  const store = useQRStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}

/**
 * Returns the nearest QR store, or undefined outside a `QRProvider`.
 * @returns The store, if any.
 */
export function useOptionalQRStore(): QRStore | undefined {
  return useContext(QRStoreContext);
}

/**
 * Returns the nearest QR store. Throws outside a `QRProvider`.
 * @returns The store.
 */
export function useQRStore() {
  const store = useContext(QRStoreContext);
  if (!store) {
    throw new Error('useQRStore must be used within QRProvider');
  }
  return store;
}
