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

const renderControls = () =>
  render(
    <ToastProvider>
      <LogoControls config={DEFAULT_CONFIG} onChange={vi.fn()} />
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

describe('LogoControls logo removal', () => {
  it('resets logoUrl and auxiliary logo parameters to default values when Remove is clicked', () => {
    const onChange = vi.fn();
    const customConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      logoPaddingStyle: 'circle' as const,
      logoPadding: 3,
      logoBackgroundColor: '#ff0000',
      logoSize: 0.28,
    };

    render(
      <ToastProvider>
        <LogoControls config={customConfig} onChange={onChange} />
      </ToastProvider>
    );

    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    expect(onChange).toHaveBeenCalledWith({
      logoUrl: null,
      logoPaddingStyle: DEFAULT_CONFIG.logoPaddingStyle,
      logoPadding: DEFAULT_CONFIG.logoPadding,
      logoBackgroundColor: DEFAULT_CONFIG.logoBackgroundColor,
      logoSize: DEFAULT_CONFIG.logoSize,
    });
  });
});
