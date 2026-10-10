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

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FrameControls } from './FrameControls';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

describe('FrameControls Component', () => {
  it('renders frame shape selector', () => {
    const onChange = vi.fn();
    render(<FrameControls config={DEFAULT_CONFIG as QRConfig} onChange={onChange} />);

    const select = screen.getByLabelText('Frame Shape');
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('none');
  });

  it('triggers onChange when frame shape changes', () => {
    const onChange = vi.fn();
    render(<FrameControls config={DEFAULT_CONFIG as QRConfig} onChange={onChange} />);

    const select = screen.getByLabelText('Frame Shape');
    fireEvent.change(select, { target: { value: 'pill' } });

    expect(onChange).toHaveBeenCalledWith({ frameStyle: 'pill' });
  });

  it('renders text, icon, and position fields when frame is enabled', () => {
    const onChange = vi.fn();
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      frameStyle: 'pill',
      frameText: 'SCAN ME',
      frameBgColor: '#000000',
      frameTextColor: '#ffffff',
    };

    render(<FrameControls config={config} onChange={onChange} />);

    expect(screen.getByLabelText('Position')).toBeInTheDocument();
    expect(screen.getByLabelText('Badge Icon')).toBeInTheDocument();
    expect(screen.getByLabelText('Call to Action Text')).toBeInTheDocument();
  });

  it('shows low contrast warning when frame text contrast is below 4.5:1', () => {
    const onChange = vi.fn();
    const lowContrastConfig: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      frameStyle: 'pill',
      frameText: 'SCAN ME',
      frameBgColor: '#ffffff',
      frameTextColor: '#f0f0f0',
    };

    render(<FrameControls config={lowContrastConfig} onChange={onChange} />);

    expect(screen.getByText(/Low Contrast/i)).toBeInTheDocument();
  });
});
