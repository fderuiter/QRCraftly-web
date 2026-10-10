import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SocialInput } from './SocialInput';
import { type SocialData, SocialPlatform } from '../../types';

describe('SocialInput', () => {
  const mockOnChange = vi.fn();
  const defaultData: SocialData = { platform: SocialPlatform.INSTAGRAM, handle: '' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default data', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);

    expect(screen.getByText('Social Media Profile')).toBeInTheDocument();

    const platformSelect = screen.getByLabelText('Platform') as HTMLSelectElement;
    expect(platformSelect).toBeInTheDocument();
    expect(platformSelect.value).toBe(SocialPlatform.INSTAGRAM);

    const handleInput = screen.getByLabelText('Username / Handle') as HTMLInputElement;
    expect(handleInput).toBeInTheDocument();
    expect(handleInput.value).toBe('');
  });

  it('calls onChange when platform is changed', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);

    const platformSelect = screen.getByLabelText('Platform');

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.TWITTER } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.TWITTER });
  });

  it('calls onChange when handle is changed', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);

    const handleInput = screen.getByLabelText('Username / Handle');

    fireEvent.change(handleInput, { target: { value: 'johndoe' } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ handle: 'johndoe' });
  });

  it('renders all platform options in the select dropdown', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);

    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    const optionValues = options.map((opt) => opt.value);

    expect(optionValues).toEqual([
      SocialPlatform.INSTAGRAM,
      SocialPlatform.TWITTER,
      SocialPlatform.TIKTOK,
      SocialPlatform.LINKEDIN,
      SocialPlatform.YOUTUBE,
      SocialPlatform.FACEBOOK,
      SocialPlatform.WHATSAPP,
      SocialPlatform.GITHUB,
    ]);
  });

  it('calls onChange when new platforms are selected', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);

    const platformSelect = screen.getByLabelText('Platform');

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.LINKEDIN } });
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.LINKEDIN });

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.YOUTUBE } });
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.YOUTUBE });

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.FACEBOOK } });
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.FACEBOOK });

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.WHATSAPP } });
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.WHATSAPP });

    fireEvent.change(platformSelect, { target: { value: SocialPlatform.GITHUB } });
    expect(mockOnChange).toHaveBeenCalledWith({ platform: SocialPlatform.GITHUB });
  });

  it('populates initial values correctly', () => {
    const data: SocialData = { platform: SocialPlatform.TIKTOK, handle: 'myhandle123' };
    render(<SocialInput data={data} onChange={mockOnChange} />);

    const platformSelect = screen.getByLabelText('Platform') as HTMLSelectElement;
    expect(platformSelect.value).toBe(SocialPlatform.TIKTOK);

    const handleInput = screen.getByLabelText('Username / Handle') as HTMLInputElement;
    expect(handleInput.value).toBe('myhandle123');
  });
});
