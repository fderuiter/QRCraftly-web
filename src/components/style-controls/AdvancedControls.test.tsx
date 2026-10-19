import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvancedControls } from './AdvancedControls';
import { DEFAULT_CONFIG } from '../../constants';
import type { QRConfig } from '../../types';

describe('AdvancedControls', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders error correction level and quiet zone margin controls when open', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      quietZoneModules: 4,
    };

    render(<AdvancedControls config={config} onChange={mockOnChange} defaultOpen={true} />);

    expect(screen.getByText('Error Correction Level')).toBeInTheDocument();
    expect(screen.getByLabelText('Quiet Zone Margin (modules)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  it('triggers onChange when error correction level changes', async () => {
    const user = userEvent.setup();
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      errorCorrectionLevel: 'H',
    };

    render(<AdvancedControls config={config} onChange={mockOnChange} defaultOpen={true} />);

    const lowRadio = screen.getByRole('radio', { name: /Set error correction level to Low/i });
    await user.click(lowRadio);

    expect(mockOnChange).toHaveBeenCalledWith({ errorCorrectionLevel: 'L' });
  });

  it('triggers onChange when quiet zone margin slider changes', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      quietZoneModules: 4,
    };

    render(<AdvancedControls config={config} onChange={mockOnChange} defaultOpen={true} />);

    const rangeInput = screen.getByLabelText('Quiet Zone Margin (modules)');
    fireEvent.change(rangeInput, { target: { value: '2' } });

    expect(mockOnChange).toHaveBeenCalledWith({ quietZoneModules: 2 });
  });

  it('displays updated quiet zone value and calls onChange with numeric value', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      quietZoneModules: 6,
    };

    render(<AdvancedControls config={config} onChange={mockOnChange} defaultOpen={true} />);

    const rangeInput = screen.getByLabelText('Quiet Zone Margin (modules)');
    expect(rangeInput).toHaveValue('6');
    expect(screen.getByText('6 modules')).toBeInTheDocument();
  });
});
