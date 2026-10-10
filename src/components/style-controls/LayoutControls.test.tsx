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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LayoutControls } from './LayoutControls';
import { DEFAULT_CONFIG } from '../../constants';
import { type QRConfig, TemplateStyle } from '../../types';

describe('LayoutControls - Contrast Warnings', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders without warning when template is active but contrast is high', () => {
    // Default config typically has high contrast (e.g. black foreground #000000, white background #ffffff)
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#ffffff',
      fgColor: '#000000',
    };

    render(<LayoutControls config={config} onChange={mockOnChange} />);

    // Warning indicators should not be present
    expect(screen.queryByTestId('layout-bg-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('layout-text-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/The contrast ratio between the layout's text and background is low/i)).not.toBeInTheDocument();
  });

  it('shows inline badges and alert card due to fallback color inheritance leading to low contrast', () => {
    // If overrides are disabled, we inherit bgColor and fgColor.
    // Let's set fgColor and bgColor to very similar colors (e.g., fgColor='#888888', bgColor='#888880')
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#888880',
      fgColor: '#888888',
      templateBgColor: undefined,
      templateTextColor: undefined,
    };

    render(<LayoutControls config={config} onChange={mockOnChange} />);

    // Warnings should be displayed
    expect(screen.getByTestId('layout-bg-warning')).toBeInTheDocument();
    expect(screen.getByTestId('layout-text-warning')).toBeInTheDocument();
    expect(screen.getByText(/The contrast ratio between the layout's text and background is low/i)).toBeInTheDocument();
  });

  it('shows inline badges and alert card when explicit custom override values lead to low contrast', () => {
    // If overrides are enabled, templateBgColor and templateTextColor are custom.
    // Let's set them to low contrast colors, while main bgColor/fgColor are high contrast.
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#ffffff',
      fgColor: '#000000',
      templateBgColor: '#e0e0e0',
      templateTextColor: '#e1e1e1',
    };

    render(<LayoutControls config={config} onChange={mockOnChange} />);

    // Warnings should be displayed
    expect(screen.getByTestId('layout-bg-warning')).toBeInTheDocument();
    expect(screen.getByTestId('layout-text-warning')).toBeInTheDocument();
    expect(screen.getByText(/The contrast ratio between the layout's text and background is low/i)).toBeInTheDocument();
  });

  it('instantly hides warning elements when contrast becomes high', () => {
    const lowContrastConfig: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#ffffff',
      fgColor: '#000000',
      templateBgColor: '#e0e0e0',
      templateTextColor: '#e1e1e1',
    };

    const { rerender } = render(<LayoutControls config={lowContrastConfig} onChange={mockOnChange} />);

    // Confirm warning elements exist
    expect(screen.getByTestId('layout-bg-warning')).toBeInTheDocument();
    expect(screen.getByTestId('layout-text-warning')).toBeInTheDocument();
    expect(screen.getByText(/The contrast ratio between the layout's text and background is low/i)).toBeInTheDocument();

    // Rerender with high contrast override colors
    const highContrastConfig: QRConfig = {
      ...lowContrastConfig,
      templateBgColor: '#ffffff',
      templateTextColor: '#000000',
    };

    rerender(<LayoutControls config={highContrastConfig} onChange={mockOnChange} />);

    // Confirm warnings are hidden instantly
    expect(screen.queryByTestId('layout-bg-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('layout-text-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/The contrast ratio between the layout's text and background is low/i)).not.toBeInTheDocument();
  });

  it('does not display warning when template style is NONE even with low-contrast active values', () => {
    // When templateStyle is NONE, warnings should not be shown even if bgColor/fgColor have low contrast
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.NONE,
      bgColor: '#888880',
      fgColor: '#888888',
    };

    render(<LayoutControls config={config} onChange={mockOnChange} />);

    expect(screen.queryByTestId('layout-bg-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('layout-text-warning')).not.toBeInTheDocument();
    expect(screen.queryByText(/The contrast ratio between the layout's text and background is low/i)).not.toBeInTheDocument();
  });

  it('does not block layout actions or input elements when low contrast warnings are active', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#888880',
      fgColor: '#888888',
      templateHeadline: 'Scan Me',
    };

    render(<LayoutControls config={config} onChange={mockOnChange} />);

    // Verify warnings exist
    expect(screen.getByTestId('layout-bg-warning')).toBeInTheDocument();

    // Verify headline input is still enabled and interactive
    const headlineInput = screen.getByRole('textbox', { name: /Template headline/i });
    expect(headlineInput).not.toBeDisabled();
    
    fireEvent.change(headlineInput, { target: { value: 'New Scan' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateHeadline: 'New Scan' });
  });

  it('has toggle switch programmatic names dynamically matching the visual state text ("Custom" or "Inherit")', () => {
    const configInherit: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateBgColor: undefined,
      templateTextColor: undefined,
    };

    const { rerender } = render(<LayoutControls config={configInherit} onChange={mockOnChange} />);

    // Programmatic names should match "Inherit" when override is disabled
    const bgSwitchInherit = screen.getByRole('switch', { name: /Override template background color - Inherit/i });
    expect(bgSwitchInherit).toBeInTheDocument();
    expect(bgSwitchInherit).toHaveAttribute('aria-label', 'Override template background color - Inherit');

    const textSwitchInherit = screen.getByRole('switch', { name: /Override template text color - Inherit/i });
    expect(textSwitchInherit).toBeInTheDocument();
    expect(textSwitchInherit).toHaveAttribute('aria-label', 'Override template text color - Inherit');

    // Render with overrides active
    const configCustom: QRConfig = {
      ...configInherit,
      templateBgColor: '#ff0000',
      templateTextColor: '#000000',
    };

    rerender(<LayoutControls config={configCustom} onChange={mockOnChange} />);

    // Programmatic names should match "Custom" when override is active
    const bgSwitchCustom = screen.getByRole('switch', { name: /Override template background color - Custom/i });
    expect(bgSwitchCustom).toBeInTheDocument();
    expect(bgSwitchCustom).toHaveAttribute('aria-label', 'Override template background color - Custom');

    // Also assert on specific regex match for "Custom" to ensure voice speech matching works
    expect(screen.getAllByRole('switch', { name: /Custom/i })).toHaveLength(2);

    const textSwitchCustom = screen.getByRole('switch', { name: /Override template text color - Custom/i });
    expect(textSwitchCustom).toBeInTheDocument();
    expect(textSwitchCustom).toHaveAttribute('aria-label', 'Override template text color - Custom');
  });
});
