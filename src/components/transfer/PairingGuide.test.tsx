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

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { PairingGuide, getReceiverUrl } from './PairingGuide';
import * as qrMatrix from '@/packages/qr-matrix';
import { qrEncoder } from '../../../tests/fixtures/qrEncoder';
import { loadQrReader } from '@/packages/qr-decode';

describe('PairingGuide', () => {
  it('renders the pairing guide card with fallback textual link', () => {
    render(<PairingGuide />);
    expect(screen.getByTestId('pairing-guide')).toBeInTheDocument();
    expect(screen.getByText('Point your other phone here')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Receive' });
    expect(link).toHaveAttribute('href', '/file-transfer/receive');
  });

  it('renders an active HTML canvas with appropriate accessibility markup and dimensions', async () => {
    render(<PairingGuide />);
    const canvas = screen.getByTestId('pairing-qr-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas.getAttribute('aria-label')).toMatch(/Pairing QR code to open receiver page/);
    expect(canvas).toHaveClass('size-24');
    expect(canvas).toHaveAttribute('width', '96');
    expect(canvas).toHaveAttribute('height', '96');
  });

  it('resolves receiver URLs correctly with defaults and overrides', () => {
    const origin = window.location.origin;
    expect(getReceiverUrl()).toBe(`${origin}/file-transfer/receive`);
    expect(getReceiverUrl('https://example.com/custom/receive')).toBe('https://example.com/custom/receive');
  });

  it('encodes the receiver URL via buildMatrix and draws to the canvas', async () => {
    const buildMatrixSpy = vi.spyOn(qrMatrix, 'buildMatrix');
    render(<PairingGuide receiverUrl="https://qrcraftly.com/file-transfer/receive" />);

    await waitFor(() => {
      expect(buildMatrixSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'URL',
          value: 'https://qrcraftly.com/file-transfer/receive',
          errorCorrectionLevel: 'M',
        }),
        expect.anything()
      );
    });

    const canvas = screen.getByTestId('pairing-qr-canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('aria-label')).toBe('Pairing QR code to open receiver page at https://qrcraftly.com/file-transfer/receive');
    buildMatrixSpy.mockRestore();
  });

  it('generates a scannable QR code decodable by standard readers', async () => {
    const targetUrl = 'https://qrcraftly.com/file-transfer/receive';
    const modules = qrMatrix.buildMatrix(
      {
        type: 'URL',
        value: targetUrl,
        errorCorrectionLevel: 'M',
      },
      qrEncoder
    );

    // Verify matrix size and structure
    expect(modules.size).toBeGreaterThan(0);

    // Read back modules using the qr-decode reader
    const reader = await loadQrReader();
    const scale = 4;
    const padding = 4;
    const fullSize = (modules.size + padding * 2) * scale;
    const frameData = new Uint8ClampedArray(fullSize * fullSize * 4).fill(255);

    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) {
        if (modules.get(r, c)) {
          for (let y = 0; y < scale; y++) {
            for (let x = 0; x < scale; x++) {
              const pixelY = (r + padding) * scale + y;
              const pixelX = (c + padding) * scale + x;
              const idx = (pixelY * fullSize + pixelX) * 4;
              frameData[idx] = 0;
              frameData[idx + 1] = 0;
              frameData[idx + 2] = 0;
              frameData[idx + 3] = 255;
            }
          }
        }
      }
    }

    const decoded = reader.read(frameData, fullSize, fullSize);
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded[0].text).toBe(targetUrl);
  });

  it('meets accessibility standards without violations', async () => {
    const { container } = render(<PairingGuide />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
