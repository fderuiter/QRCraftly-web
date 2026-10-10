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
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './ui/Toast';
import QRTool from './QRTool';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType, type QRConfig } from '@/types';
import { getSamplePayload } from '@/packages/qr-payload';
import { clearRetainedInputStates } from './inputs/useInputLogic';

// The preview canvas reports the config it was given and has a painted size, so the mockup
// scene can copy it.
vi.mock('./QRCanvas', () => ({
  default: React.forwardRef<HTMLCanvasElement, { config: QRConfig }>(function QRCanvasMock({ config }, ref) {
    return <canvas ref={ref} width={200} height={200} data-testid="qr-canvas-mock" data-encoded-value={config.value} />;
  }),
}));

const triggerFileDownload = vi.hoisted(() => vi.fn());
vi.mock('@/utils/downloadManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/downloadManager')>()),
  triggerFileDownload,
}));

/** An image that loads as soon as it is given a source. */
class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const encodedValue = () => screen.getByTestId('qr-canvas-mock').getAttribute('data-encoded-value');
const downloadButton = () => screen.getByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ });

function renderTool(config: Partial<QRConfig>) {
  return render(
    <ToastProvider>
      <QRTool initialConfig={{ ...DEFAULT_CONFIG, ...config }} />
    </ToastProvider>,
  );
}

async function openPosterScene() {
  fireEvent.click(screen.getByRole('radio', { name: 'Poster' }));
  return screen.findByRole('button', { name: /Download mockup PNG/ });
}

describe('QRTool export gates', () => {
  // The scene view is lazy. Load it up front so a busy machine does not outlast findBy's wait.
  beforeAll(async () => {
    await import('./mockups/MockupView');
  }, 30_000);

  beforeEach(() => {
    clearRetainedInputStates();
    window.localStorage.clear();
    triggerFileDownload.mockReset();
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['mock'], { type: 'image/png' })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('Image', LoadingImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('an empty form shows the sample, not a skeleton code (#1272)', () => {
    it.each([QRType.EMAIL, QRType.PHONE, QRType.SMS, QRType.WIFI, QRType.VCARD, QRType.EVENT])('%s starts on the sample with exports off', (type) => {
      renderTool({ type, value: '' });

      expect(screen.getByTestId('sample-preview-badge')).toBeInTheDocument();
      expect(encodedValue()).toBe(getSamplePayload(type));
      expect(downloadButton()).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('button', { name: /Copy QR code/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('goes back to the sample when a typed phone number is cleared', async () => {
      renderTool({ type: QRType.PHONE, value: '' });
      const field = screen.getByLabelText(/Phone Number/i);

      fireEvent.change(field, { target: { value: '+1 555 0100' } });
      await waitFor(() => expect(screen.queryByTestId('sample-preview-badge')).not.toBeInTheDocument());

      fireEvent.change(field, { target: { value: '' } });
      await waitFor(() => expect(screen.getByTestId('sample-preview-badge')).toBeInTheDocument());
      expect(downloadButton()).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('the mockup download goes through the export checks (#1253)', () => {
    it('does not download the sample code as a mockup', async () => {
      renderTool({ type: QRType.URL, value: '' });
      const mockupDownload = await openPosterScene();
      await waitFor(() => expect(mockupDownload).toBeEnabled());

      expect(mockupDownload).toHaveAttribute('aria-disabled', 'true');
      expect(mockupDownload).toHaveAttribute('aria-describedby', 'qr-empty-state');
      fireEvent.click(mockupDownload);

      expect(await screen.findByText(/Enter content to generate a QR code/)).toBeInTheDocument();
      expect(triggerFileDownload).not.toHaveBeenCalled();
    });

    it('asks before downloading a mockup of a code that will not scan', async () => {
      renderTool({ type: QRType.URL, value: 'https://example.com', fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' });
      const mockupDownload = await openPosterScene();
      await waitFor(() => expect(mockupDownload).toBeEnabled());

      fireEvent.click(mockupDownload);
      expect(await screen.findByText('Scan Safety Warning')).toBeInTheDocument();
      expect(triggerFileDownload).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Export Anyway' }));
      });
      await waitFor(() => expect(triggerFileDownload).toHaveBeenCalledWith(expect.any(Uint8Array), 'qrcraftly-poster-mockup.png', 'image/png'));
    });
  });

  describe('a refused field never leaves the old code exportable (#1279)', () => {
    it('blanks the preview and turns exports off until the field is fixed', async () => {
      renderTool({ type: QRType.WIFI, value: '' });
      const ssid = screen.getByLabelText('Network Name (SSID)');
      const password = screen.getByLabelText('Password');

      fireEvent.change(ssid, { target: { value: 'HomeNet' } });
      fireEvent.change(password, { target: { value: 'oldpass1' } });
      await waitFor(() => expect(encodedValue()).toContain('P:oldpass1;'));

      fireEvent.change(password, { target: { value: 'newpass2​' } });
      fireEvent.change(ssid, { target: { value: 'HomeNet5G' } });
      await waitFor(() => expect(screen.getByTestId('refused-content-badge')).toHaveTextContent('Fix the highlighted field'));
      await waitFor(() => expect(encodedValue()).toBe(''));
      expect(screen.queryByTestId('sample-preview-badge')).not.toBeInTheDocument();
      expect(downloadButton()).toHaveAttribute('aria-disabled', 'true');
      expect(downloadButton()).toHaveAttribute('aria-describedby', 'qr-refused-state');

      fireEvent.click(downloadButton());
      expect(await screen.findByText(/Fix the highlighted content first/)).toBeInTheDocument();

      fireEvent.change(password, { target: { value: 'newpass2' } });
      await waitFor(() => expect(screen.queryByTestId('refused-content-badge')).not.toBeInTheDocument());
      await waitFor(() => expect(encodedValue()).toContain('S:HomeNet5G;'));
      expect(encodedValue()).toContain('P:newpass2;');
      expect(downloadButton()).not.toHaveAttribute('aria-disabled');
    });
  });
});
