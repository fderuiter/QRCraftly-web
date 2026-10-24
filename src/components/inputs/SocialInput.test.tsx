import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SocialInput } from './SocialInput';
import { type SocialData, SocialPlatform } from '@/packages/qr-payload';
import { axe } from '../../../tests/utils/axe';

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

  it('does not render pre-filled message field for non-WhatsApp platforms', () => {
    render(<SocialInput data={defaultData} onChange={mockOnChange} />);
    expect(screen.queryByLabelText(/Pre-filled Message/i)).not.toBeInTheDocument();
  });

  it('renders multi-line TextAreaField for WhatsApp platform with character count and passes axe accessibility check', async () => {
    const whatsappData: SocialData = {
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
      message: 'Hello\nWorld',
    };
    const { container } = render(<SocialInput data={whatsappData} onChange={mockOnChange} />);

    const messageInput = screen.getByLabelText(/Pre-filled Message/i) as HTMLTextAreaElement;
    expect(messageInput).toBeInTheDocument();
    expect(messageInput.tagName.toLowerCase()).toBe('textarea');
    expect(messageInput.value).toBe('Hello\nWorld');
    expect(messageInput.getAttribute('maxLength')).toBe('256');

    // Verify character count is displayed (11 / 256)
    expect(screen.getByText('11 / 256')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it('calls onChange when WhatsApp pre-filled message changes', () => {
    const whatsappData: SocialData = {
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
      message: '',
    };
    render(<SocialInput data={whatsappData} onChange={mockOnChange} />);

    const messageInput = screen.getByLabelText(/Pre-filled Message/i);
    fireEvent.change(messageInput, { target: { value: 'Inquiry about service:\nLine 1\nLine 2' } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ message: 'Inquiry about service:\nLine 1\nLine 2' });
  });

  it('configures YouTube input label, placeholder, maxLength, and passes axe accessibility check', async () => {
    const youtubeData: SocialData = {
      platform: SocialPlatform.YOUTUBE,
      handle: '',
    };
    const { container } = render(<SocialInput data={youtubeData} onChange={mockOnChange} />);

    const handleInput = (await screen.findByLabelText('Username / Channel / Video Link')) as HTMLInputElement;
    expect(handleInput).toBeInTheDocument();
    expect(handleInput.getAttribute('placeholder')).toBe('@channel, video link, or channel ID');
    expect(handleInput.getAttribute('maxLength')).toBe('256');

    expect(await axe(container)).toHaveNoViolations();
  });
});
