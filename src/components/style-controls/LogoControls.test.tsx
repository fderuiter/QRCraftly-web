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
import { useEffect } from 'react';
import { fireEvent, render, screen, within, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LogoControls } from './LogoControls';
import { ToastProvider } from '../ui/Toast';
import { DEFAULT_CONFIG } from '../../constants';
import { PRESET_LOGOS } from '../../constants/presetLogos';
import { QRErrorCorrectionLevel, type QRConfig } from '../../types';
import { QRProvider, useQRStore, useQRStoreSelector } from '../../context/QRContext';

let storeHandle: ReturnType<typeof useQRStore>;

function Harness({ configOverrides = {}, onChange }: { configOverrides?: Partial<QRConfig>; onChange?: (u: Partial<QRConfig>) => void }) {
  const store = useQRStore();
  useEffect(() => {
    storeHandle = store;
  }, [store]);
  const config = useQRStoreSelector((s) => s.config);
  return (
    <LogoControls
      config={config}
      onChange={(updates) => {
        storeHandle.updateConfig(updates);
        onChange?.(updates);
      }}
    />
  );
}

const renderControls = (configOverrides: Partial<QRConfig> = {}, onChange = vi.fn()) =>
  render(
    <ToastProvider>
      <QRProvider initialConfig={{ ...DEFAULT_CONFIG, ...configOverrides }}>
        <Harness configOverrides={configOverrides} onChange={onChange} />
      </QRProvider>
    </ToastProvider>
  );

describe('LogoControls preset categories (#1366)', () => {
  it('moves between category tabs with the arrow keys and filters the panel', () => {
    renderControls();
    const all = screen.getByRole('tab', { name: 'All' });
    expect(all).toHaveAttribute('tabindex', '0');

    all.focus();
    fireEvent.keyDown(all, { key: 'ArrowRight' });

    const social = screen.getByRole('tab', { name: 'Social' });
    expect(social).toHaveAttribute('aria-selected', 'true');
    expect(social).toHaveFocus();

    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', social.id);
    const socialCount = PRESET_LOGOS.filter((preset) => preset.category === 'social').length;
    expect(within(panel).getAllByRole('button')).toHaveLength(socialCount);
  });
});

describe('LogoControls error correction level auto-elevation', () => {
  it('auto-elevates errorCorrectionLevel to H when selecting a preset logo', () => {
    const onChange = vi.fn();
    renderControls({ logoUrl: null, errorCorrectionLevel: QRErrorCorrectionLevel.M }, onChange);

    const firstPreset = PRESET_LOGOS[0];
    const presetButton = screen.getByRole('button', { name: `Select ${firstPreset.label} logo` });
    fireEvent.click(presetButton);

    expect(onChange).toHaveBeenCalledWith({
      logoUrl: firstPreset.dataUrl,
      errorCorrectionLevel: QRErrorCorrectionLevel.H,
    });
  });

  it('auto-elevates errorCorrectionLevel to H when uploading a custom logo', () => {
    const onChange = vi.fn();
    renderControls({ logoUrl: null, errorCorrectionLevel: QRErrorCorrectionLevel.M }, onChange);

    const fileInput = screen.getByLabelText('Upload logo image');
    const file = new File(['dummy content'], 'logo.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(fileInput).toBeInTheDocument();
  });
});

describe('LogoControls user override tracking', () => {
  it('marks logo as user overridden when selecting a preset logo or removing a logo', () => {
    const onChange = vi.fn();
    renderControls({ logoUrl: null }, onChange);
    expect(storeHandle.getState().isLogoOverridden).toBe(false);

    const firstPreset = PRESET_LOGOS[0];
    const presetButton = screen.getByRole('button', { name: `Select ${firstPreset.label} logo` });
    fireEvent.click(presetButton);

    expect(storeHandle.getState().isLogoOverridden).toBe(true);

    // Test remove button
    act(() => {
      storeHandle.updateConfig({ logoUrl: firstPreset.dataUrl });
    });
    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    expect(onChange).toHaveBeenCalledWith({ logoUrl: null });
    expect(storeHandle.getState().isLogoOverridden).toBe(true);
  });
});


