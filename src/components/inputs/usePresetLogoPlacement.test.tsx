import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { QRProvider, useQRStore, clearRetainedAppearance, type QRStore } from '../../context/QRContext';
import { QRErrorCorrectionLevel, QRType, type QRConfig } from '@/packages/core/types';
import { PRESET_LOGOS, TYPE_TO_PRESET_LOGO, presetLogoForType } from '../../constants/presetLogos';
import { usePresetLogoPlacement, resetPresetLogoPlacement } from './usePresetLogoPlacement';
import { useInputLogic } from './useInputLogic';

const dataUrlOf = (id: string): string => {
  const preset = PRESET_LOGOS.find((p) => p.id === id);
  if (!preset) throw new Error(`No preset ${id}`);
  return preset.dataUrl;
};

/** Mounts the hook in a generator and hands back its store. */
const Probe = ({ type, onStore }: { type: QRType; onStore: (store: QRStore) => void }) => {
  const store = useQRStore();
  onStore(store);
  usePresetLogoPlacement(type);
  return null;
};

/** One generator route: a fresh store that keeps appearance between routes, like the app's. */
const mountRoute = (type: QRType, initialConfig?: Partial<QRConfig>) => {
  let store: QRStore | undefined;
  const view = render(
    <QRProvider initialConfig={{ type, ...initialConfig }} retainAppearance>
      <Probe type={type} onStore={(s) => { store = s; }} />
    </QRProvider>
  );
  if (!store) throw new Error('store not captured');
  return { view, store };
};

/** Lets the dynamic preset import resolve. */
const settle = () => act(async () => { await import('../../constants/presetLogos'); });

describe('TYPE_TO_PRESET_LOGO', () => {
  it('names only presets that exist', () => {
    for (const id of Object.values(TYPE_TO_PRESET_LOGO)) {
      expect(PRESET_LOGOS.some((preset) => preset.id === id)).toBe(true);
    }
  });

  it('has no preset for Wi-Fi, Event, Text or Bulk', () => {
    for (const type of [QRType.WIFI, QRType.EVENT, QRType.TEXT, QRType.BULK_CSV]) {
      expect(presetLogoForType(type)).toBeNull();
    }
  });
});

describe('usePresetLogoPlacement', () => {
  beforeEach(() => {
    resetPresetLogoPlacement();
    clearRetainedAppearance();
  });

  it('places nothing on the first generator of a visit', async () => {
    const { store } = mountRoute(QRType.EMAIL);
    await settle();
    expect(store.getState().config.logoUrl).toBeNull();
  });

  it('places the matching preset when the type changes in place, and keeps the error correction', async () => {
    let store: QRStore | undefined;
    const capture = (s: QRStore) => { store = s; };
    const { rerender } = render(
      <QRProvider initialConfig={{ type: QRType.TEXT, errorCorrectionLevel: QRErrorCorrectionLevel.L }}>
        <Probe type={QRType.TEXT} onStore={capture} />
      </QRProvider>
    );
    rerender(
      <QRProvider initialConfig={{ type: QRType.TEXT, errorCorrectionLevel: QRErrorCorrectionLevel.L }}>
        <Probe type={QRType.PHONE} onStore={capture} />
      </QRProvider>
    );
    await waitFor(() => expect(store?.getState().config.logoUrl).toBe(dataUrlOf('phone')));
    expect(store?.getState().config.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.L);
  });

  it('places the preset when a type switch mounts a new generator route', async () => {
    const first = mountRoute(QRType.TEXT);
    first.view.unmount();
    const { store } = mountRoute(QRType.URL);
    await waitFor(() => expect(store.getState().config.logoUrl).toBe(dataUrlOf('website')));
  });

  it('swaps a placed preset for the next type, and takes it off for a type with none', async () => {
    mountRoute(QRType.TEXT).view.unmount();
    const url = mountRoute(QRType.URL);
    await waitFor(() => expect(url.store.getState().config.logoUrl).toBe(dataUrlOf('website')));
    url.view.unmount();

    const sms = mountRoute(QRType.SMS);
    await waitFor(() => expect(sms.store.getState().config.logoUrl).toBe(dataUrlOf('chat')));
    sms.view.unmount();

    const wifi = mountRoute(QRType.WIFI);
    await waitFor(() => expect(wifi.store.getState().config.logoUrl).toBeNull());
  });

  it('keeps a logo the person uploaded', async () => {
    const own = 'data:image/png;base64,iVBORw0KGgo=';
    const text = mountRoute(QRType.TEXT);
    act(() => text.store.updateConfig({ logoUrl: own }));
    text.view.unmount();

    const { store } = mountRoute(QRType.EMAIL);
    await settle();
    expect(store.getState().config.logoUrl).toBe(own);
  });

  it('keeps a preset the person chose over the placed one', async () => {
    mountRoute(QRType.TEXT).view.unmount();
    const url = mountRoute(QRType.URL);
    await waitFor(() => expect(url.store.getState().config.logoUrl).toBe(dataUrlOf('website')));
    act(() => url.store.updateConfig({ logoUrl: dataUrlOf('bitcoin') }));
    url.view.unmount();

    const { store } = mountRoute(QRType.PHONE);
    await settle();
    expect(store.getState().config.logoUrl).toBe(dataUrlOf('bitcoin'));
  });

  it('does not put a placed logo back after the person removes it', async () => {
    mountRoute(QRType.TEXT).view.unmount();
    const url = mountRoute(QRType.URL);
    await waitFor(() => expect(url.store.getState().config.logoUrl).toBe(dataUrlOf('website')));
    act(() => url.store.updateConfig({ logoUrl: null }));
    url.view.unmount();

    const { store } = mountRoute(QRType.PHONE);
    await settle();
    expect(store.getState().config.logoUrl).toBeNull();
  });

  it('makes the placement one undo step', async () => {
    let store: QRStore | undefined;
    const capture = (s: QRStore) => { store = s; };
    const { rerender } = render(<QRProvider><Probe type={QRType.TEXT} onStore={capture} /></QRProvider>);
    rerender(<QRProvider><Probe type={QRType.LOCATION} onStore={capture} /></QRProvider>);
    await waitFor(() => expect(store?.getState().config.logoUrl).toBe(dataUrlOf('location')));
    act(() => { store?.undo(); });
    expect(store?.getState().config.logoUrl).toBeNull();
  });

  it('places nothing when the type does not change', async () => {
    let store: QRStore | undefined;
    const capture = (s: QRStore) => { store = s; };
    const { rerender } = render(<QRProvider><Probe type={QRType.URL} onStore={capture} /></QRProvider>);
    rerender(<QRProvider><Probe type={QRType.URL} onStore={capture} /></QRProvider>);
    await settle();
    expect(store?.getState().config.logoUrl).toBeNull();
  });

  it('runs inside useInputLogic', async () => {
    let store: QRStore | undefined;
    const capture = (s: QRStore) => { store = s; };
    const Panel = ({ type, onStore }: { type: QRType; onStore: (store: QRStore) => void }) => {
      onStore(useQRStore());
      useInputLogic({ type, value: '' }, () => {});
      return null;
    };
    const { rerender } = render(<QRProvider><Panel type={QRType.TEXT} onStore={capture} /></QRProvider>);
    rerender(<QRProvider><Panel type={QRType.VCARD} onStore={capture} /></QRProvider>);
    await waitFor(() => expect(store?.getState().config.logoUrl).toBe(dataUrlOf('profile')));
  });

  it('does nothing outside a generator', async () => {
    const Bare = ({ type }: { type: QRType }) => { usePresetLogoPlacement(type); return null; };
    const { rerender } = render(<Bare type={QRType.TEXT} />);
    expect(() => rerender(<Bare type={QRType.URL} />)).not.toThrow();
    await settle();
  });
});
