import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeetingInput } from './MeetingInput';
import type { MeetingData } from '../../types';
import { announcePolitely } from '../../utils/a11y';

vi.mock('../../utils/a11y', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/a11y')>();
  return {
    ...actual,
    announcePolitely: vi.fn(),
  };
});

describe('MeetingInput', () => {
  const mockOnChange = vi.fn();
  const defaultData: MeetingData = { url: '' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with empty data', () => {
    render(<MeetingInput data={defaultData} onChange={mockOnChange} />);

    expect(screen.getByText('Meeting Link')).toBeInTheDocument();

    const input = screen.getByLabelText('Paste Meeting Link') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('');

    expect(screen.queryByText(/link detected/i)).not.toBeInTheDocument();
  });

  it('calls onChange when input value changes', () => {
    render(<MeetingInput data={defaultData} onChange={mockOnChange} />);

    const input = screen.getByLabelText('Paste Meeting Link');
    const newUrl = 'https://zoom.us/j/1234567890';

    fireEvent.change(input, { target: { value: newUrl } });

    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith({ url: newUrl });
  });

  it('displays Zoom meeting details correctly', () => {
    const data: MeetingData = { url: 'https://zoom.us/j/987654321?pwd=MyPasscode' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(screen.getByText('Zoom link detected')).toBeInTheDocument();
    expect(screen.getByText('987654321')).toBeInTheDocument(); // Meeting ID
    expect(screen.getByText('MyPasscode')).toBeInTheDocument(); // Passcode
  });

  it('displays Teams meeting details correctly', () => {
    // Basic teams link for testing
    const data: MeetingData = { url: 'https://teams.microsoft.com/l/meetup-join/19%3Ameeting_MDIxYm...%40thread.v2/0' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(screen.getByText('Microsoft Teams link detected')).toBeInTheDocument();
    expect(screen.getByText('19:meeting_MDIxYm...@thread.v2')).toBeInTheDocument(); // Meeting ID (from thread)
  });

  it('displays Google Meet details correctly', () => {
    const data: MeetingData = { url: 'https://meet.google.com/abc-defg-hij' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(screen.getByText('Google Meet link detected')).toBeInTheDocument();
    expect(screen.getByText('abc-defg-hij')).toBeInTheDocument(); // Meeting ID
  });

  it('does not display details for an unknown URL', () => {
    const data: MeetingData = { url: 'https://example.com/meeting' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(screen.queryByText(/link detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Meeting ID:/i)).not.toBeInTheDocument();
  });

  it('renders correctly with an unknown URL and does not show details', () => {
    const data: MeetingData = { url: 'https://example.com/unknown-meeting' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(screen.getByText('Meeting Link')).toBeInTheDocument();

    const input = screen.getByLabelText('Paste Meeting Link') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('https://example.com/unknown-meeting');

    expect(screen.queryByText(/link detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Meeting ID:/i)).not.toBeInTheDocument();
  });

  it('announces Google Meet when a matching service URL is supplied', () => {
    const data: MeetingData = { url: 'https://meet.google.com/abc-defg-hij' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(announcePolitely).toHaveBeenCalledTimes(1);
    expect(announcePolitely).toHaveBeenCalledWith('Google Meet detected');
  });

  it('announces Zoom when a matching service URL is supplied', () => {
    const data: MeetingData = { url: 'https://zoom.us/j/987654321?pwd=MyPasscode' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(announcePolitely).toHaveBeenCalledTimes(1);
    expect(announcePolitely).toHaveBeenCalledWith('Zoom detected');
  });

  it('announces Microsoft Teams when a matching service URL is supplied', () => {
    const data: MeetingData = { url: 'https://teams.microsoft.com/l/meetup-join/19%3Ameeting_MDIxYm...%40thread.v2/0' };
    render(<MeetingInput data={data} onChange={mockOnChange} />);

    expect(announcePolitely).toHaveBeenCalledTimes(1);
    expect(announcePolitely).toHaveBeenCalledWith('Microsoft Teams detected');
  });

  it('does not trigger repeated announcements for subsequent keystrokes on the same service', () => {
    const { rerender } = render(<MeetingInput data={{ url: 'https://zoom.us/j/987' }} onChange={mockOnChange} />);
    expect(announcePolitely).toHaveBeenCalledTimes(1);
    expect(announcePolitely).toHaveBeenCalledWith('Zoom detected');

    // Simulate subsequent keystrokes
    rerender(<MeetingInput data={{ url: 'https://zoom.us/j/9876' }} onChange={mockOnChange} />);
    rerender(<MeetingInput data={{ url: 'https://zoom.us/j/98765' }} onChange={mockOnChange} />);

    // Total calls should still be 1 because service has not changed from zoom
    expect(announcePolitely).toHaveBeenCalledTimes(1);
  });
});
