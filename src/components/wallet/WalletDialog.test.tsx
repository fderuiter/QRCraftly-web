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

const scan = vi.hoisted(() => ({
  success: true,
  check: null as null | ((canvas: unknown) => Promise<boolean>),
}));
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
vi.mock('@/packages/scannability/scan', () => ({
  isCanvasScannable: async (canvas: unknown) => (scan.check ? scan.check(canvas) : scan.success),
}));
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
    scan.check = null;
    download.mockClear();
  });

  it('has no axe violations, shows a preview and downloads the card', async () => {
    const { baseElement } = open({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Home;P:secret;;' });
    expect(screen.getByLabelText('Title')).toHaveValue('WiFi: Home');
    expect(await screen.findByTestId('wallet-card-preview')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-scannability-badge')).toHaveTextContent('Scans reliably');
    expect(screen.getByTestId('wallet-scannability-live-region')).toHaveTextContent('Card scannability: Scans reliably.');
    const downloadButton = screen.getByRole('button', { name: 'Download card' });
    expect(downloadButton).toBeEnabled();
    expect(await axe(baseElement)).toHaveNoViolations();
    fireEvent.click(downloadButton);
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0][1]).toBe('wifi-Home-wallet-card.png');
    expect(download.mock.calls[0][2]).toBe('image/png');
  });

  it('does not save a card that fails the scan check and disables export', async () => {
    scan.success = false;
    const { baseElement } = open({ type: QRType.URL, value: 'https://example.com' });
    const warning = await screen.findByTestId('wallet-scannability-warning');
    expect(warning).toBeInTheDocument();
    expect(warning).toHaveTextContent(/shorter content/i);
    expect(screen.getByRole('button', { name: 'Download card' })).toBeDisabled();
    expect(screen.getByTestId('wallet-scannability-badge')).toHaveTextContent("Won't scan reliably");
    expect(screen.getByTestId('wallet-scannability-live-region')).toHaveTextContent(/Optical verification failed/i);
    expect(download).not.toHaveBeenCalled();
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('retains the final scannability verification in makeCard as a defense-in-depth safety guard', async () => {
    scan.success = true;
    open({ type: QRType.URL, value: 'https://example.com' });
    expect(await screen.findByTestId('wallet-card-preview')).toBeInTheDocument();
    const downloadButton = screen.getByRole('button', { name: 'Download card' });
    expect(downloadButton).toBeEnabled();

    scan.success = false;
    fireEvent.click(downloadButton);
    expect(await screen.findByText(WALLET_SCAN_FAILED)).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('disables download while optical validation is checking and transitions to passed', async () => {
    let resolveCheck: ((scannable: boolean) => void) | undefined;
    scan.check = () => new Promise<boolean>((resolve) => { resolveCheck = resolve; });

    open({ type: QRType.URL, value: 'https://example.com' });
    expect(screen.getByTestId('wallet-scannability-badge')).toHaveTextContent('Checking…');
    expect(screen.getByRole('button', { name: 'Download card' })).toBeDisabled();
    expect(screen.getByTestId('wallet-scannability-live-region')).toHaveTextContent('Checking card scannability…');

    await waitFor(() => expect(resolveCheck).toBeDefined());
    resolveCheck!(true);
    expect(await screen.findByText('Scans reliably')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download card' })).toBeEnabled();
    expect(screen.getByTestId('wallet-scannability-live-region')).toHaveTextContent('Card scannability: Scans reliably.');
  });

  it('disables the share button when scannability check fails', async () => {
    const originalCanShare = navigator.canShare;
    const originalShare = navigator.share;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true, writable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true, writable: true });

    try {
      scan.success = false;
      open({ type: QRType.URL, value: 'https://example.com' });
      expect(await screen.findByTestId('wallet-scannability-warning')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download card' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Share card' })).toBeDisabled();
    } finally {
      Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true, writable: true });
      Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true, writable: true });
    }
  });

  it('updates scannability verdict and alert when user edits text', async () => {
    scan.success = true;
    open({ type: QRType.URL, value: 'https://example.com' });
    expect(await screen.findByText('Scans reliably')).toBeInTheDocument();
    expect(screen.queryByTestId('wallet-scannability-warning')).not.toBeInTheDocument();

    scan.success = false;
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Very long title that forces high density' } });
    expect(await screen.findByText("Won't scan reliably")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download card' })).toBeDisabled();
    expect(screen.getByTestId('wallet-scannability-warning')).toBeInTheDocument();
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
