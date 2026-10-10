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
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { ToastProvider } from './ui/Toast';
import QRTool from './QRTool';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType } from '@/types';
import { getSamplePayload } from '@/packages/qr-payload';

// The sample fallback needs its own module mocks: a scannability result left
// over from the last non-empty value, and a spy on the export hook.
vi.mock('@/hooks/useScannability', () => ({
  useScannability: () => ({
    status: 'physical-pass',
    health: { score: 100, warnings: [] },
    checkScannability: vi.fn(),
    workerRecoveryActive: false,
  }),
}));

vi.mock('./QRCanvas', () => ({
  default: (props: { config: { value: string } }) => (
    <canvas data-testid="qr-canvas-mock" data-encoded-value={props.config.value} />
  ),
}));

const exportAsset = vi.fn();
vi.mock('@/hooks/useQRDownload', () => ({
  useQRDownload: () => ({ exportAsset }),
}));

describe('QRTool with sample fallback empty state', () => {
  beforeEach(() => {
    exportAsset.mockReset();
    window.localStorage.clear();
  });

  it('shows Sample Preview badge and active canvas instead of verified badge when content is empty', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: '' }} /></ToastProvider>);

    const preview = screen.getByRole('region', { name: 'QR Code Preview' });
    expect(within(preview).getByTestId('sample-preview-badge')).toHaveTextContent('Sample Preview');
    expect(within(preview).getByTestId('qr-canvas-mock')).toBeInTheDocument();
    expect(within(preview).queryByText(/verified/i)).not.toBeInTheDocument();
    expect(within(preview).queryByText(/Health:/i)).not.toBeInTheDocument();
    expect(within(preview).getByTestId('scannability-indicator-placeholder')).toBeInTheDocument();
  });

  it('marks export actions protected and displays alert toast instead of exporting', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: '' }} /></ToastProvider>);

    const download = screen.getByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ });
    const copy = screen.getByRole('button', { name: /Copy QR code/ });

    for (const button of [download, copy]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }

    fireEvent.click(download);
    expect(exportAsset).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter content to generate a QR code\. Exports are available/)).toBeInTheDocument();
  });

  it('hides sample preview badge and restores the verdict when user provides content', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: 'https://example.com' }} /></ToastProvider>);

    expect(screen.queryByTestId('sample-preview-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('scannability-verdict')).toHaveTextContent('Scans reliably');
    const download = screen.getByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ });
    expect(download).not.toHaveAttribute('aria-disabled');
  });

  it('has no axe violations in sample preview state', async () => {
    const { container } = render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: '' }} /></ToastProvider>);
    const preview = screen.getByRole('region', { name: 'QR Code Preview' });
    expect(await axe(preview)).toHaveNoViolations();
    expect(container).toBeTruthy();
  });
});

describe('Type-Aware Fallback Sample Payload Engine Integration', () => {
  it('renders type-specific sample payload in QRCanvas when config value is empty', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: '', type: QRType.WIFI }} /></ToastProvider>);

    expect(screen.getByTestId('sample-preview-badge')).toBeInTheDocument();
    const canvas = screen.getByTestId('qr-canvas-mock');
    expect(canvas).toBeInTheDocument();

    const expectedWifiSample = getSamplePayload(QRType.WIFI);
    expect(canvas.getAttribute('data-encoded-value')).toBe(expectedWifiSample);
  });

  it('updates sample preview value when initial QRType differs', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: '', type: QRType.VCARD }} /></ToastProvider>);

    const canvas = screen.getByTestId('qr-canvas-mock');
    const expectedVCardSample = getSamplePayload(QRType.VCARD);
    expect(canvas.getAttribute('data-encoded-value')).toBe(expectedVCardSample);
  });

  it('deactivates sample preview mode as soon as non-empty custom value is present', () => {
    render(<ToastProvider><QRTool initialConfig={{ ...DEFAULT_CONFIG, value: 'https://mycustomsite.com', type: QRType.URL }} /></ToastProvider>);

    expect(screen.queryByTestId('sample-preview-badge')).not.toBeInTheDocument();
    const canvas = screen.getByTestId('qr-canvas-mock');
    expect(canvas.getAttribute('data-encoded-value')).toBe('https://mycustomsite.com');
  });
});
