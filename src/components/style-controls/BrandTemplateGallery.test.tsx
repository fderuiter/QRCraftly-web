import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrandTemplateGallery } from './BrandTemplateGallery';
import { DEFAULT_CONFIG } from '../../constants';
import { QRConfig, QRStyle } from '../../types';
import { BRAND_TEMPLATES_STORAGE_KEY } from '../../utils/brandTemplateManager';

describe('BrandTemplateGallery Component', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    mockOnChange.mockReset();
  });

  it('renders pre-built gallery presets by default', () => {
    render(<BrandTemplateGallery config={DEFAULT_CONFIG} onChange={mockOnChange} />);

    expect(screen.getByText('Classic Slate')).toBeInTheDocument();
    expect(screen.getByText('Modern Teal')).toBeInTheDocument();
    expect(screen.getByText('Save as Template')).toBeInTheDocument();
    expect(screen.getByText('Import JSON')).toBeInTheDocument();
  });

  it('applies a preset template when Apply button is clicked', () => {
    render(<BrandTemplateGallery config={DEFAULT_CONFIG} onChange={mockOnChange} />);

    const applyButtons = screen.getAllByRole('button', { name: /apply/i });
    expect(applyButtons.length).toBeGreaterThan(0);

    fireEvent.click(applyButtons[0]);

    expect(mockOnChange).toHaveBeenCalled();
    const calls = mockOnChange.mock.calls[0][0];
    expect(calls.fgColor).toBeDefined();
    expect(calls.bgColor).toBeDefined();
    // Non-style fields must not be present
    expect(calls.value).toBeUndefined();
    expect(calls.type).toBeUndefined();
  });

  it('allows saving current visual settings as a custom brand template', async () => {
    render(<BrandTemplateGallery config={DEFAULT_CONFIG} onChange={mockOnChange} />);

    // Click "Save as Template"
    const saveModalButton = screen.getByRole('button', { name: /save current visual settings as brand template/i });
    fireEvent.click(saveModalButton);

    // Modal opens
    const input = screen.getByLabelText(/template name/i);
    fireEvent.change(input, { target: { value: 'My Brand Dark' } });

    const submitButton = screen.getByRole('button', { name: /^save template$/i });
    fireEvent.click(submitButton);

    // Custom tab should now display the newly saved template
    await waitFor(() => {
      expect(screen.getByText('My Brand Dark')).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(BRAND_TEMPLATES_STORAGE_KEY) || '[]');
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe('My Brand Dark');
  });

  it('switches between Curated Presets and My Templates tabs', () => {
    render(<BrandTemplateGallery config={DEFAULT_CONFIG} onChange={mockOnChange} />);

    const myTemplatesTab = screen.getByRole('tab', { name: /my templates/i });
    fireEvent.click(myTemplatesTab);

    expect(screen.getByText(/no custom templates saved yet/i)).toBeInTheDocument();

    const presetsTab = screen.getByRole('tab', { name: /curated presets/i });
    fireEvent.click(presetsTab);

    expect(screen.getByText('Classic Slate')).toBeInTheDocument();
  });

  it('stays usable with a note when the browser blocks site storage', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    try {
      render(<BrandTemplateGallery config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expect(screen.getByText('Classic Slate')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: /my templates/i }));
      expect(screen.getByText('Custom templates are unavailable.')).toBeInTheDocument();
    } finally {
      getter.mockRestore();
    }
  });
});
