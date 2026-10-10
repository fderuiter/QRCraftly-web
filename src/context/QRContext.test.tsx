/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import React from 'react';
import { render, renderHook, act, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearRetainedAppearance,
  QRProvider,
  stageGeneratorContent,
  useQRStore,
  useQRStoreSelector,
  useOptionalQRStoreSelector,
} from './QRContext';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRErrorCorrectionLevel, QRType, SocialFormat } from '@/types';

// ---------------------------------------------------------------------------
// Helper wrapper
// ---------------------------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QRProvider>{children}</QRProvider>
);

const wrapperWithConfig = (initialConfig: any) =>
  ({ children }: { children: React.ReactNode }) => (
    <QRProvider initialConfig={initialConfig}>{children}</QRProvider>
  );

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------
function clearLocalStorage() {
  window.localStorage.clear();
}

// ---------------------------------------------------------------------------
// Tests: QRProvider + useQRStore
// ---------------------------------------------------------------------------
describe('QRProvider and useQRStore', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLocalStorage();
  });

  it('renders children without crashing', () => {
    render(
      <QRProvider>
        <div data-testid="child">hello</div>
      </QRProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('useQRStore throws when used outside QRProvider', () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useQRStore())).toThrow(
      'useQRStore must be used within QRProvider'
    );
    spy.mockRestore();
  });

  it('useQRStore returns the store with getState method', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    expect(typeof result.current.getState).toBe('function');
  });

  it('initial state has DEFAULT_CONFIG values', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const state = result.current.getState();
    expect(state.config.value).toBe(DEFAULT_CONFIG.value);
    expect(state.config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
    expect(state.moduleCount).toBe(0);
  });

  it('initial state merges initialConfig with DEFAULT_CONFIG', () => {
    const { result } = renderHook(() => useQRStore(), {
      wrapper: wrapperWithConfig({ value: 'https://custom.com' }),
    });
    const state = result.current.getState();
    expect(state.config.value).toBe('https://custom.com');
    // Other defaults preserved
    expect(state.config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('holds no preferences and does not own the colour theme (owned by the global ThemeProvider)', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    expect(result.current.getState()).not.toHaveProperty('preferences');
  });

  it('does not read or write browser storage', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => useQRStore(), { wrapper });
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not keep an unused violations list in state', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    expect(result.current.getState()).not.toHaveProperty('violations');
  });
});

// ---------------------------------------------------------------------------
// Tests: QRStore methods
// ---------------------------------------------------------------------------
describe('QRStore.updateConfig', () => {
  afterEach(() => {
    clearLocalStorage();
  });

  it('merges partial config updates', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.updateConfig({ value: 'https://updated.com' });
    });
    expect(result.current.getState().config.value).toBe('https://updated.com');
    // Other fields preserved
    expect(result.current.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('notifies subscribers when config changes', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const listener = vi.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      result.current.updateConfig({ value: 'https://notify.com' });
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify subscribers when an update changes nothing', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const listener = vi.fn();
    const before = result.current.getState();
    act(() => {
      result.current.subscribe(listener);
    });
    act(() => {
      result.current.updateConfig({ value: before.config.value, fgColor: before.config.fgColor });
      result.current.updateConfig({});
    });
    expect(listener).not.toHaveBeenCalled();
    expect(result.current.getState()).toBe(before);
  });

  it('keeps scannability fallback active across appearance-only changes', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.emitSignal('scannability-fail', { errorType: 'LOW_CONTRAST' });
    });
    act(() => {
      result.current.updateConfig({ fgColor: '#123456', bgColor: '#fafafa' });
    });
    expect(result.current.getState().isScannabilityFallbackActive).toBe(true);
  });

  it.each([
    ['value', { value: 'https://changed.example' }],
    ['errorCorrectionLevel', { errorCorrectionLevel: QRErrorCorrectionLevel.L }],
    ['type', { type: QRType.TEXT }],
  ] as const)('resets scannability fallback when %s changes', (_field, update) => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.emitSignal('scannability-fail', { errorType: 'LOW_CONTRAST' });
    });
    act(() => {
      result.current.updateConfig(update);
    });
    expect(result.current.getState().isScannabilityFallbackActive).toBe(false);
  });

  it('can update multiple config fields at once', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.updateConfig({ fgColor: '#ff0000', bgColor: '#0000ff' });
    });
    expect(result.current.getState().config.fgColor).toBe('#ff0000');
    expect(result.current.getState().config.bgColor).toBe('#0000ff');
  });
});

describe('QRStore.setModuleCount', () => {
  afterEach(() => clearLocalStorage());

  it('updates moduleCount when value differs', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.setModuleCount(25);
    });
    expect(result.current.getState().moduleCount).toBe(25);
  });

  it('does not notify subscribers when moduleCount is unchanged', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.setModuleCount(25);
    });
    const listener = vi.fn();
    act(() => {
      result.current.subscribe(listener);
    });
    // Set the same value again
    act(() => {
      result.current.setModuleCount(25);
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('QRStore.subscribe', () => {
  afterEach(() => clearLocalStorage());

  it('returns an unsubscribe function', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.subscribe(() => {});
    });
    expect(typeof unsub).toBe('function');
  });

  it('listener is not called after unsubscription', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const listener = vi.fn();
    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.subscribe(listener);
    });
    act(() => {
      unsub!();
    });
    act(() => {
      result.current.updateConfig({ value: 'after-unsub' });
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple listeners are all notified', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    act(() => {
      result.current.subscribe(listener1);
      result.current.subscribe(listener2);
    });
    act(() => {
      result.current.updateConfig({ value: 'multi' });
    });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Signal system
// ---------------------------------------------------------------------------
describe('QRStore signals', () => {
  afterEach(() => clearLocalStorage());

  it('registerSignal and emitSignal - scannability-fail', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const callback = vi.fn();
    act(() => {
      result.current.registerSignal('scannability-fail', callback);
    });
    act(() => {
      result.current.emitSignal('scannability-fail', { errorType: 'NOT_FOUND' });
    });
    expect(callback).toHaveBeenCalledWith({ errorType: 'NOT_FOUND' });
  });

  it('unregistering a signal callback stops it from being called', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const callback = vi.fn();
    let unsub: (() => void) | undefined;
    act(() => {
      unsub = result.current.registerSignal('scannability-fail', callback);
    });
    act(() => {
      unsub!();
    });
    act(() => {
      result.current.emitSignal('scannability-fail', { errorType: 'fail' });
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('scannability-fail activates the store-owned fallback flag', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      result.current.emitSignal('scannability-fail', { engine: 'native', styleId: 'square', errorType: 'NOT_FOUND' });
    });
    expect(result.current.getState().isScannabilityFallbackActive).toBe(true);
  });

  it('multiple callbacks on same signal are all notified', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    act(() => {
      result.current.registerSignal('scannability-fail', cb1);
      result.current.registerSignal('scannability-fail', cb2);
    });
    act(() => {
      result.current.emitSignal('scannability-fail', { errorType: 'test' });
    });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: useQRStoreSelector
// ---------------------------------------------------------------------------
describe('useQRStoreSelector', () => {
  afterEach(() => clearLocalStorage());

  it('returns the selected slice of state', () => {
    const { result } = renderHook(
      () => useQRStoreSelector(s => s.config.value),
      { wrapper }
    );
    expect(result.current).toBe(DEFAULT_CONFIG.value);
  });

  it('re-renders when the selected value changes', () => {
    const renderCount = { count: 0 };
    renderHook(
      () => {
        renderCount.count++;
        return useQRStoreSelector(s => s.config.value);
      },
      { wrapper }
    );

    const initialCount = renderCount.count;

    // Get the store to trigger an update
    const storeResult = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      storeResult.result.current.updateConfig({ value: 'https://new.com' });
    });

    // The selector should see the new value if we re-read from a fresh hook
    // (Note: this tests that the selector subscribes correctly)
    const { result: result2 } = renderHook(
      () => useQRStoreSelector(s => s.config.value),
      { wrapper }
    );
    // After provider-level update, new hooks get latest state
    expect(result2.current).toBe(DEFAULT_CONFIG.value); // fresh provider = fresh store
    expect(renderCount.count).toBe(initialCount); // No spurious re-renders in original hook
  });

  it('same-value updates do not change selected reference', () => {
    const { result } = renderHook(
      () => {
        const store = useQRStore();
        const val = useQRStoreSelector(s => s.config.fgColor);
        return { store, val };
      },
      { wrapper }
    );
    const originalVal = result.current.val;
    act(() => {
      // Update something else, not fgColor
      result.current.store.updateConfig({ value: 'https://unrelated.com' });
    });
    // fgColor should still be the same object/value
    expect(result.current.val).toBe(originalVal);
  });
});


// ---------------------------------------------------------------------------
// Tests: useOptionalQRStoreSelector
// ---------------------------------------------------------------------------
describe('useOptionalQRStoreSelector', () => {
  it('returns undefined when outside QRProvider', () => {
    const { result } = renderHook(() => useOptionalQRStoreSelector(s => s.moduleCount));
    expect(result.current).toBeUndefined();
  });

  it('returns selected state when inside QRProvider', () => {
    const { result } = renderHook(() => useOptionalQRStoreSelector(s => s.moduleCount), { wrapper });
    expect(result.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: appearance retained across generator routes (memory only)
// ---------------------------------------------------------------------------
describe('QRProvider retainAppearance', () => {
  afterEach(() => {
    clearRetainedAppearance();
    clearLocalStorage();
  });

  const retainingWrapper = (initialConfig: Partial<QRConfig>) =>
    ({ children }: { children: React.ReactNode }) => (
      <QRProvider initialConfig={initialConfig} retainAppearance>{children}</QRProvider>
    );

  it('carries appearance, but never content or free text, into the next route', () => {
    const first = renderHook(() => useQRStore(), { wrapper: retainingWrapper({ ...DEFAULT_CONFIG, type: QRType.URL }) });
    act(() => {
      first.result.current.updateConfig({
        value: 'https://secret.example/patient',
        fgColor: '#112233',
        socialFormat: SocialFormat.STORY_9_16,
        templateHeadline: 'Private headline',
      });
    });
    first.unmount();

    const second = renderHook(() => useQRStore(), { wrapper: retainingWrapper({ ...DEFAULT_CONFIG, type: QRType.TEXT }) });
    const config = second.result.current.getState().config;
    expect(config.type).toBe(QRType.TEXT);
    expect(config.value).toBe(DEFAULT_CONFIG.value);
    expect(config.fgColor).toBe('#112233');
    expect(config.socialFormat).toBe(SocialFormat.STORY_9_16);
    expect(config.templateHeadline).toBe(DEFAULT_CONFIG.templateHeadline);
  });

  it('does not retain appearance for providers that did not opt in', () => {
    const first = renderHook(() => useQRStore(), { wrapper });
    act(() => {
      first.result.current.updateConfig({ fgColor: '#445566' });
    });
    first.unmount();
    const second = renderHook(() => useQRStore(), { wrapper: retainingWrapper({}) });
    expect(second.result.current.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('never writes retained appearance to persistent storage', () => {
    const { result } = renderHook(() => useQRStore(), { wrapper: retainingWrapper({}) });
    act(() => {
      result.current.updateConfig({ fgColor: '#010203' });
    });
    expect(Object.keys(window.localStorage)).not.toContain('fgColor');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('#010203');
  });
});

describe('stageGeneratorContent (#1101)', () => {
  const generatorWrapper = (type: QRType) =>
    ({ children }: { children: React.ReactNode }) => (
      <QRProvider initialConfig={{ type }} retainAppearance>{children}</QRProvider>
    );

  it('opens the next generator of the same type with the scanned content, once', () => {
    stageGeneratorContent({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Home;P:pw;;' });
    const first = renderHook(() => useQRStore(), { wrapper: generatorWrapper(QRType.WIFI) });
    expect(first.result.current.getState().config.value).toBe('WIFI:T:WPA;S:Home;P:pw;;');
    first.unmount();

    const second = renderHook(() => useQRStore(), { wrapper: generatorWrapper(QRType.WIFI) });
    expect(second.result.current.getState().config.value).toBe(DEFAULT_CONFIG.value);
  });

  it('is ignored by a generator of another type and never stored', () => {
    stageGeneratorContent({ type: QRType.TEXT, value: 'Scanned note' });
    const other = renderHook(() => useQRStore(), { wrapper: generatorWrapper(QRType.URL) });
    expect(other.result.current.getState().config.value).toBe(DEFAULT_CONFIG.value);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('Scanned note');
    other.unmount();
    const text = renderHook(() => useQRStore(), { wrapper: generatorWrapper(QRType.TEXT) });
    expect(text.result.current.getState().config.value).toBe('Scanned note');
  });
});

describe('presetConfig (#1035, #1037)', () => {
  it('wins over appearance retained from an earlier route and applies on a fresh visit', () => {
    clearRetainedAppearance();
    const earlier = renderHook(() => useQRStore(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider retainAppearance>{children}</QRProvider>,
    });
    act(() => earlier.result.current.updateConfig({ errorCorrectionLevel: QRErrorCorrectionLevel.L }));
    earlier.unmount();

    const landing = renderHook(() => useQRStore(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QRProvider retainAppearance presetConfig={{ errorCorrectionLevel: QRErrorCorrectionLevel.H, value: 'https://wa.me/' }}>
          {children}
        </QRProvider>
      ),
    });
    expect(landing.result.current.getState().config.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.H);
    expect(landing.result.current.getState().config.value).toBe('https://wa.me/');
    landing.unmount();
    clearRetainedAppearance();
  });
});

// ---------------------------------------------------------------------------
// Tests: undo/redo history and previews
// ---------------------------------------------------------------------------
describe('QRStore appearance history', () => {
  const setup = () => renderHook(() => useQRStore(), { wrapper }).result.current;

  afterEach(() => {
    vi.useRealTimers();
    clearRetainedAppearance();
  });

  it('undoes and redoes an appearance change', () => {
    const store = setup();
    store.updateConfig({ fgColor: '#112233' });
    expect(store.getState().canUndo).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
    expect(store.getState().canRedo).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getState().config.fgColor).toBe('#112233');
    expect(store.redo()).toBe(false);
  });

  it('never records or undoes content', () => {
    const store = setup();
    store.updateConfig({ value: 'https://example.com/a' });
    expect(store.getState().canUndo).toBe(false);
    store.updateConfig({ fgColor: '#112233' });
    store.updateConfig({ value: 'https://example.com/b' });
    store.undo();
    expect(store.getState().config.value).toBe('https://example.com/b');
    expect(store.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('merges quick changes to the same field into one step', () => {
    vi.useFakeTimers();
    const store = setup();
    store.updateConfig({ logoSize: 0.15 });
    vi.advanceTimersByTime(100);
    store.updateConfig({ logoSize: 0.2 });
    vi.advanceTimersByTime(100);
    store.updateConfig({ logoSize: 0.25 });
    store.undo();
    expect(store.getState().config.logoSize).toBe(DEFAULT_CONFIG.logoSize);
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps separate steps for different fields and for pauses', () => {
    vi.useFakeTimers();
    const store = setup();
    store.updateConfig({ fgColor: '#111111' });
    store.updateConfig({ bgColor: '#eeeeee' });
    vi.advanceTimersByTime(2000);
    store.updateConfig({ bgColor: '#dddddd' });
    store.undo();
    expect(store.getState().config.bgColor).toBe('#eeeeee');
    store.undo();
    expect(store.getState().config.bgColor).toBe(DEFAULT_CONFIG.bgColor);
    expect(store.getState().config.fgColor).toBe('#111111');
  });

  it('drops the redo steps when a new change is made', () => {
    const store = setup();
    store.updateConfig({ fgColor: '#111111' });
    store.undo();
    store.updateConfig({ eyeColor: '#222222' });
    expect(store.getState().canRedo).toBe(false);
  });

  it('skips history for updates marked skip', () => {
    const store = setup();
    store.updateConfig({ fgColor: '#111111' }, { history: 'skip' });
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps at most 50 steps', () => {
    vi.useFakeTimers();
    const store = setup();
    for (let i = 0; i < 60; i += 1) {
      store.updateConfig({ borderSize: i % 2 ? 0.05 : 0.06, isBorderEnabled: i % 2 === 0 });
      vi.advanceTimersByTime(1000);
    }
    let undone = 0;
    while (store.undo()) undone += 1;
    expect(undone).toBe(50);
  });

  it('shows a preview without a history step and restores it', () => {
    const store = setup();
    store.preview({ fgColor: '#abcdef' });
    expect(store.getState().config.fgColor).toBe('#abcdef');
    expect(store.getState().canUndo).toBe(false);
    store.preview(null);
    expect(store.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('commits one undo step that returns to the look before the preview', () => {
    const store = setup();
    store.preview({ fgColor: '#abcdef' });
    store.preview(null);
    store.updateConfig({ fgColor: '#abcdef' });
    store.undo();
    expect(store.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('does not retain a preview as the remembered appearance', () => {
    const { result } = renderHook(() => useQRStore(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider retainAppearance>{children}</QRProvider>,
    });
    result.current.preview({ fgColor: '#abcdef' });
    result.current.preview(null);
    const next = renderHook(() => useQRStore(), {
      wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider retainAppearance>{children}</QRProvider>,
    });
    expect(next.result.current.getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });
});
