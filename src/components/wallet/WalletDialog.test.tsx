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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { type QRConfig, QRType } from '@/packages/core/types';
import { ToastProvider } from '../ui/Toast';
import WalletDialog, { suggestWalletTitle, WALLET_SCAN_FAILED } from './WalletDialog';

const scan = vi.hoisted(() => ({ success: true }));
const download = vi.hoisted(() => vi.fn());

vi.mock('@/packages/qr-export', async (original) => {
  const actual = await original<typeof import('@/packages/qr-export')>();
  return {
    ...actual,
    renderWalletCard: vi.fn(async (config: QRConfig) => {
      const refusal = actual.walletRefusalReason(config.type);
      if (refusal) throw new Error(refusal);
      return {
        width: 1080,
        height: 1920,
        toDataURL: () => 'data:image/png;base64,AAAA',
        toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
        getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) }),
      };
    }),
  };
});
vi.mock('@/packages/scannability/scan', () => ({ isCanvasScannable: async () => scan.success }));
vi.mock('@/utils/downloadManager', () => ({ triggerFileDownload: download }));

const DEVELOPER_SECTION = 'Have your own Apple or Google developer keys?';

function open(config: Partial<QRConfig>) {
  return render(
    <ToastProvider>
      <WalletDialog isOpen onClose={() => undefined} config={{ ...DEFAULT_CONFIG, ...config }} filename="wifi-Home" />
    </ToastProvider>
  );
}

describe('WalletDialog (ADR 0048)', () => {
  beforeEach(() => {
    scan.success = true;
    download.mockClear();
  });

  it('has no axe violations, shows a preview and downloads the card', async () => {
    const { baseElement } = open({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Home;P:secret;;' });
    expect(screen.getByLabelText('Title')).toHaveValue('WiFi: Home');
    expect(await screen.findByTestId('wallet-card-preview')).toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Download card' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0][1]).toBe('wifi-Home-wallet-card.png');
    expect(download.mock.calls[0][2]).toBe('image/png');
  });

  it('does not save a card that fails the scan check', async () => {
    scan.success = false;
    open({ type: QRType.URL, value: 'https://example.com' });
    fireEvent.click(screen.getByRole('button', { name: 'Download card' }));
    expect(await screen.findByText(WALLET_SCAN_FAILED)).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps the signed passes in a closed developer section until it is opened', async () => {
    const { baseElement } = open({ type: QRType.URL, value: 'https://example.com' });
    const toggle = screen.getByRole('button', { name: DEVELOPER_SECTION });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wallet-developer-section')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('apple-pass-panel')).toBeInTheDocument();
    expect(screen.getByText(/never uploaded or saved/)).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'wallet-tab-apple');
    // The card image stays available above the developer section.
    expect(screen.getByRole('button', { name: 'Download card' })).toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('switches to the Google Wallet pass tab in the developer section', async () => {
    open({ type: QRType.URL, value: 'https://example.com' });
    fireEvent.click(screen.getByRole('button', { name: DEVELOPER_SECTION }));
    fireEvent.click(screen.getByRole('tab', { name: 'Google Wallet pass' }));
    expect(await screen.findByTestId('google-pass-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('apple-pass-panel')).not.toBeInTheDocument();
  });

  it('keeps the pass panel mounted when the developer section is collapsed again', async () => {
    open({ type: QRType.URL, value: 'https://example.com' });
    const toggle = screen.getByRole('button', { name: DEVELOPER_SECTION });
    fireEvent.click(toggle);
    expect(await screen.findByTestId('apple-pass-panel')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('apple-pass-panel')).toBeInTheDocument();
  });

  it('offers no card for payment codes', () => {
    open({ type: QRType.PAYMENT, value: 'bitcoin:bc1qexample' });
    expect(screen.getByText(/lock screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download card' })).not.toBeInTheDocument();
  });

  it('suggests a title from the content, never a password', () => {
    expect(suggestWalletTitle({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Cafe;P:hunter2;;' })).toBe('WiFi: Cafe');
    expect(suggestWalletTitle({ type: QRType.URL, value: 'https://www.qrcraftly.com/x' })).toBe('qrcraftly.com');
    expect(suggestWalletTitle({ type: QRType.TEXT, value: 'note' })).toBe('Text');
    expect(suggestWalletTitle({ type: QRType.URL, value: 'not a link' })).toBe('URL');
  });
});
