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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LogoControls } from './LogoControls';
import { ToastProvider } from '../ui/Toast';
import { DEFAULT_CONFIG } from '../../constants';
import { PRESET_LOGOS } from '../../constants/presetLogos';
import { QRErrorCorrectionLevel, type QRConfig } from '../../types';

const renderControls = (configOverrides: Partial<QRConfig> = {}, onChange = vi.fn()) =>
  render(
    <ToastProvider>
      <LogoControls config={{ ...DEFAULT_CONFIG, ...configOverrides }} onChange={onChange} />
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

  it('does not render duplicate warning alert in LogoControls panel when logo is present', () => {
    renderControls({
      logoUrl: PRESET_LOGOS[0].dataUrl,
      errorCorrectionLevel: QRErrorCorrectionLevel.M,
    });

    expect(screen.queryByText('Scannability Warning:')).not.toBeInTheDocument();
  });
});

