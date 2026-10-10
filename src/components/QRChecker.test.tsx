/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { QRChecker } from './QRChecker';
import { checkQrImage } from '@/components/checker/checkImage';
import { describeScan } from '@/components/scanner/describeScan';

vi.mock('@/components/checker/checkImage', () => ({ checkQrImage: vi.fn() }));

const image = () => new File(['x'], 'code.png', { type: 'image/png' });

describe('QRChecker (#1036)', () => {
  afterEach(() => vi.mocked(checkQrImage).mockReset());

  it('offers a file, paste and drop input with the privacy promise, and no axe violations', async () => {
    const { container } = render(<QRChecker />);
    expect(screen.getByRole('button', { name: 'Choose picture' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a picture of a QR code')).toHaveAttribute('accept', 'image/*');
    expect(screen.getByText(/never leaves this device/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows what a chosen picture holds with the scan verdict', async () => {
    vi.mocked(checkQrImage).mockResolvedValue({ kind: 'read', scan: describeScan('https://example.com/menu'), status: 'physical-pass' });
    render(<QRChecker />);
    fireEvent.change(screen.getByLabelText('Choose a picture of a QR code'), { target: { files: [image()] } });
    expect(await screen.findByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('Scans reliably')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /scan another/i }));
    expect(screen.getByRole('button', { name: 'Choose picture' })).toBeInTheDocument();
  });

  it('shows a blocked code without a verdict', async () => {
    vi.mocked(checkQrImage).mockResolvedValue({ kind: 'read', scan: describeScan('javascript:alert(1)'), status: null });
    render(<QRChecker />);
    fireEvent.change(screen.getByLabelText('Choose a picture of a QR code'), { target: { files: [image()] } });
    expect(await screen.findByText(/not tested for scanning/)).toBeInTheDocument();
  });

  it('announces a picture with no code as an alert and keeps the input', async () => {
    vi.mocked(checkQrImage).mockResolvedValue({ kind: 'unreadable', message: 'No QR code was found in this picture.' });
    render(<QRChecker />);
    fireEvent.change(screen.getByLabelText('Choose a picture of a QR code'), { target: { files: [image()] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('No QR code was found');
    expect(screen.getByRole('button', { name: 'Choose picture' })).toBeInTheDocument();
  });

  it('checks a pasted screenshot and a dropped picture, and turns away other files', async () => {
    vi.mocked(checkQrImage).mockResolvedValue({ kind: 'unreadable', message: 'None.' });
    render(<QRChecker />);
    const paste = new Event('paste') as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image()] } });
    document.dispatchEvent(paste);
    await waitFor(() => expect(checkQrImage).toHaveBeenCalledTimes(1));

    const zone = screen.getByTestId('qr-checker');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(checkQrImage).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose an image');
    fireEvent.drop(zone, { dataTransfer: { files: [image()] } });
    await waitFor(() => expect(checkQrImage).toHaveBeenCalledTimes(2));
  });

  describe('every input starts a check or says why not (#1298)', () => {
    it('checks a picture whose file has no type, as the scanner does', async () => {
      vi.mocked(checkQrImage).mockResolvedValue({ kind: 'unreadable', message: 'None.' });
      render(<QRChecker />);
      fireEvent.change(screen.getByLabelText('Choose a picture of a QR code'), { target: { files: [new File(['x'], 'IMG_0001', { type: '' })] } });
      await waitFor(() => expect(checkQrImage).toHaveBeenCalledTimes(1));
    });

    it('says so when a dropped file is not a picture', async () => {
      render(<QRChecker />);
      fireEvent.drop(screen.getByTestId('qr-checker'), { dataTransfer: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } });
      expect(await screen.findByRole('alert')).toHaveTextContent('Please choose an image');
      expect(checkQrImage).not.toHaveBeenCalled();
    });

    it('shows the check and its failure for a picture pasted over a result', async () => {
      vi.mocked(checkQrImage).mockResolvedValueOnce({ kind: 'read', scan: describeScan('https://example.com/menu'), status: 'physical-pass' });
      render(<QRChecker />);
      fireEvent.change(screen.getByLabelText('Choose a picture of a QR code'), { target: { files: [image()] } });
      expect(await screen.findByText('example.com')).toBeInTheDocument();

      let finish: (outcome: Awaited<ReturnType<typeof checkQrImage>>) => void = () => {};
      vi.mocked(checkQrImage).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const paste = new Event('paste') as ClipboardEvent;
      Object.defineProperty(paste, 'clipboardData', { value: { files: [image()] } });
      document.dispatchEvent(paste);
      expect(await screen.findByText('Checking...')).toBeInTheDocument();

      finish({ kind: 'unreadable', message: 'No QR code was found in this picture.' });
      expect(await screen.findByText('No QR code was found in this picture.')).toHaveAttribute('role', 'alert');
      expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    });
  });
});
