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
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clearRetainedAppearance, QRProvider, useQRStore } from '@/context/QRContext';
import { type QRConfig, QRErrorCorrectionLevel, QRType } from '@/packages/core/types';
import { PRESET_LOGOS, presetLogoForType, TYPE_TO_PRESET_LOGO } from '@/constants/presetLogos';
import { useTypePresetLogo } from './useTypePresetLogo';

/** The store plus the hook, driven by the store's own type, the way the generator wires them. */
function setup(initialConfig?: Partial<QRConfig>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <QRProvider initialConfig={initialConfig}>{children}</QRProvider>;
  return renderHook(
    () => {
      const store = useQRStore();
      const type = React.useSyncExternalStore(store.subscribe, () => store.getState().config.type);
      useTypePresetLogo(type);
      return store;
    },
    { wrapper }
  );
}

const logoOf = (type: QRType) => presetLogoForType(type)?.dataUrl;
/** Lets the dynamic import of the presets resolve. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('useTypePresetLogo (#1554)', () => {
  afterEach(() => clearRetainedAppearance());

  it('maps every listed type to an existing preset', () => {
    for (const id of Object.values(TYPE_TO_PRESET_LOGO)) expect(PRESET_LOGOS.some((preset) => preset.id === id)).toBe(true);
    expect(TYPE_TO_PRESET_LOGO[QRType.URL]).toBeUndefined();
  });

  it('places nothing for the type a route opens with', async () => {
    const { result } = setup({ type: QRType.EMAIL });
    await settle();
    expect(result.current.getState().config.logoUrl).toBeNull();
  });

  it("places the new type's preset on a switch, keeping the error correction level", async () => {
    const { result } = setup({ errorCorrectionLevel: QRErrorCorrectionLevel.M });
    act(() => result.current.updateConfig({ type: QRType.EMAIL, value: '' }));
    await waitFor(() => expect(result.current.getState().config.logoUrl).toBe(logoOf(QRType.EMAIL)));
    expect(result.current.getState().config.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.M);

    act(() => result.current.updateConfig({ type: QRType.SMS, value: '' }));
    await waitFor(() => expect(result.current.getState().config.logoUrl).toBe(logoOf(QRType.SMS)));

    // A type without a preset takes the automatic logo away again.
    act(() => result.current.updateConfig({ type: QRType.TEXT, value: '' }));
    await waitFor(() => expect(result.current.getState().config.logoUrl).toBeNull());
  });

  it("keeps the person's own logo through every switch", async () => {
    const own = 'data:image/png;base64,iVBORw0KGgo=';
    const { result } = setup();
    act(() => result.current.updateConfig({ logoUrl: own, errorCorrectionLevel: QRErrorCorrectionLevel.H }));
    for (const type of [QRType.EMAIL, QRType.TEXT, QRType.PHONE]) {
      act(() => result.current.updateConfig({ type, value: '' }));
      await settle();
      expect(result.current.getState().config.logoUrl).toBe(own);
    }
  });

  it('keeps a removed logo removed', async () => {
    const { result } = setup();
    act(() => result.current.updateConfig({ type: QRType.EMAIL, value: '' }));
    await waitFor(() => expect(result.current.getState().config.logoUrl).toBe(logoOf(QRType.EMAIL)));
    act(() => result.current.updateConfig({ logoUrl: null }));
    act(() => result.current.updateConfig({ type: QRType.PHONE, value: '' }));
    await settle();
    expect(result.current.getState().config.logoUrl).toBeNull();
  });

  it('applies only the last of several quick switches', async () => {
    const { result } = setup();
    act(() => {
      result.current.updateConfig({ type: QRType.EMAIL, value: '' });
    });
    act(() => {
      result.current.updateConfig({ type: QRType.LOCATION, value: '' });
    });
    await settle();
    expect(result.current.getState().config.logoUrl).toBe(logoOf(QRType.LOCATION));
  });
});
