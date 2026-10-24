import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UrlInput } from './UrlInput';
import type { UrlData } from '@/packages/qr-payload';

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

  it('warns, without blocking, when the text cannot be a web address', () => {
    render(<UrlInput data={{ url: 'not a url' }} onChange={mockOnChange} />);

    expect(screen.getByTestId('field-hints').textContent).toContain("doesn't look like a web address");
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves a typo as typed on blur, so it can be fixed', () => {
    render(<UrlInput data={{ url: 'not a url' }} onChange={mockOnChange} />);

    fireEvent.blur(screen.getByLabelText('Website URL'));

    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('says nothing for a real address', () => {
    render(<UrlInput data={{ url: 'example.com/menu' }} onChange={mockOnChange} />);

    expect(screen.queryByText(/doesn't look like a web address/)).not.toBeInTheDocument();
  });

  it('selects the sample address on focus, so typing replaces it', () => {
    render(<UrlInput data={{ url: 'https://qrcraftly.com' }} onChange={mockOnChange} />);

    const urlInput = screen.getByLabelText('Website URL') as HTMLInputElement;
    fireEvent.focus(urlInput);

    expect(urlInput.selectionStart).toBe(0);
    expect(urlInput.selectionEnd).toBe(urlInput.value.length);
  });
});
