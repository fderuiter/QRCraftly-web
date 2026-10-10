import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BorderControls } from './BorderControls';
import { DEFAULT_CONFIG } from '../../constants';
import type { QRConfig } from '../../types';

describe('BorderControls', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders border style and size selectors when border is enabled', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      isBorderEnabled: true,
    };

    render(<BorderControls config={config} onChange={mockOnChange} />);

    // Should have visual label 'Style'
    expect(screen.getByLabelText('Style')).toBeInTheDocument();
  });

  it('completely removes redundant aria-label attributes and relies on visually hidden HTML labels for text position selection', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      isBorderEnabled: true,
      borderText: 'Hello',
    };

    render(<BorderControls config={config} onChange={mockOnChange} />);

    // The select element should have a label with text 'Border text position'
    const select = screen.getByRole('combobox', { name: 'Border text position' });
    expect(select).toBeInTheDocument();

    // Verify it doesn't have a redundant aria-label attribute
    expect(select).not.toHaveAttribute('aria-label');
  });

  it('completely removes redundant aria-label attributes and relies on visually hidden HTML labels for logo position selection', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      isBorderEnabled: true,
      borderLogoUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    };

    render(<BorderControls config={config} onChange={mockOnChange} />);

    // The select element should have a label with text 'Border logo position'
    const select = screen.getByRole('combobox', { name: 'Border logo position' });
    expect(select).toBeInTheDocument();

    // Verify it doesn't have a redundant aria-label attribute
    expect(select).not.toHaveAttribute('aria-label');
  });

  it('triggers onChange when selecting a different border text position', async () => {
    const user = userEvent.setup();
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      isBorderEnabled: true,
      borderText: 'Hello',
      borderTextPosition: 'bottom-center',
    };

    render(<BorderControls config={config} onChange={mockOnChange} />);

    const select = screen.getByRole('combobox', { name: 'Border text position' });
    await user.selectOptions(select, 'top-center');

    expect(mockOnChange).toHaveBeenCalledWith({ borderTextPosition: 'top-center' });
  });
});
