import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { MosaicControls } from './MosaicControls';
import { DEFAULT_CONFIG } from '../../constants';
import { type QRConfig, QRErrorCorrectionLevel } from '../../types';

describe('MosaicControls', () => {
  const onChange = vi.fn();
  const base = DEFAULT_CONFIG as QRConfig;
  const withImage: QRConfig = { ...base, mosaicImageUrl: 'data:image/png;base64,mosaic' };
  const originalFileReader = global.FileReader;

  beforeEach(() => onChange.mockClear());
  afterEach(() => {
    global.FileReader = originalFileReader;
  });

  it('offers an upload button that says the image stays on the device', () => {
    render(<MosaicControls config={base} onChange={onChange} />);
    const button = screen.getByRole('button', { name: /upload mosaic design/i });
    expect(button).toHaveAccessibleDescription(/stays on this device/i);
  });

  it('sets the image and high error correction on upload', async () => {
    const user = userEvent.setup();
    global.FileReader = class {
      onload: ((e: { target: { result: string } }) => void) | null = null;
      readAsDataURL() {
        this.onload?.({ target: { result: 'data:image/png;base64,uploaded' } });
      }
    } as unknown as typeof FileReader;

    render(<MosaicControls config={base} onChange={onChange} />);
    const file = new File(['img'], 'design.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Upload mosaic design'), file);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        mosaicImageUrl: 'data:image/png;base64,uploaded',
        errorCorrectionLevel: QRErrorCorrectionLevel.H,
      });
    });
  });

  it('switches layout, adjusts contrast and removes the image', async () => {
    const user = userEvent.setup();
    render(<MosaicControls config={withImage} onChange={onChange} />);

    expect(screen.getByRole('radio', { name: /halftone/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /tiles/i }));
    expect(onChange).toHaveBeenCalledWith({ mosaicMode: 'tiles' });

    const slider = screen.getByLabelText('Scan Contrast');
    expect(slider).toHaveValue('0.5');
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(onChange).toHaveBeenCalledWith({ mosaicContrast: 0.8 });

    await user.click(screen.getByRole('button', { name: 'Remove mosaic image' }));
    expect(onChange).toHaveBeenCalledWith({ mosaicImageUrl: null });
  });

  it('has no accessibility violations with and without an image', async () => {
    const { container, rerender } = render(<MosaicControls config={base} onChange={onChange} />);
    expect(await axe(container)).toHaveNoViolations();
    rerender(<MosaicControls config={withImage} onChange={onChange} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
