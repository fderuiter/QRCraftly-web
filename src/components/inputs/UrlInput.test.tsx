import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UrlInput } from './UrlInput';
import type { UrlData } from '../../types';

describe('UrlInput', () => {
  const mockOnChange = vi.fn();
  const defaultData: UrlData = { url: '' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default data', () => {
    render(<UrlInput data={defaultData} onChange={mockOnChange} />);

    const urlInput = screen.getByLabelText('Website URL') as HTMLInputElement;
    expect(urlInput).toBeInTheDocument();
    expect(urlInput.value).toBe('');
    expect(urlInput.placeholder).toBe('https://example.com');
  });

  it('calls onChange when typing', () => {
    render(<UrlInput data={defaultData} onChange={mockOnChange} />);

    const urlInput = screen.getByLabelText('Website URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'google' } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ url: 'google' });
  });

  it('normalizes the URL on blur', () => {
    const data: UrlData = { url: 'google.com' };
    render(<UrlInput data={data} onChange={mockOnChange} />);

    const urlInput = screen.getByLabelText('Website URL') as HTMLInputElement;
    fireEvent.blur(urlInput);

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ url: 'https://google.com/' });
  });

  it('displays validation error for dangerous urls', () => {
    const data: UrlData = { url: 'javascript:alert(1)' };
    render(<UrlInput data={data} onChange={mockOnChange} />);

    const alertMessage = screen.getByRole('alert');
    expect(alertMessage).toBeInTheDocument();
    expect(alertMessage.textContent).toContain('Unsafe URL scheme or malicious protocol detected.');
  });

});
