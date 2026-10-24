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
import { QRType } from '@/packages/core/types';
import { ToastProvider } from '../ui/Toast';
import ApplePassPanel from './ApplePassPanel';

const mocks = vi.hoisted(() => ({
  createPassSigner: vi.fn(),
  buildApplePass: vi.fn(),
  download: vi.fn(),
}));

vi.mock('@/packages/wallet-pass', async (original) => ({
  ...(await original<typeof import('@/packages/wallet-pass')>()),
  createPassSigner: mocks.createPassSigner,
  buildApplePass: mocks.buildApplePass,
}));
vi.mock('./passImages', () => ({ renderPassImages: async () => ({ 'icon.png': Uint8Array.of(1) }) }));
vi.mock('@/utils/downloadManager', () => ({ triggerFileDownload: mocks.download }));

const signer = { passTypeIdentifier: 'pass.com.example.menu', teamIdentifier: 'ABCDE12345', organizationName: 'Example', expires: new Date(Date.UTC(2027, 0, 2)), sign: vi.fn() };

function open() {
  return render(
    <ToastProvider>
      <ApplePassPanel config={{ ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://example.com' }} title="Menu" subtitle="" filename="url-example.com" />
    </ToastProvider>
  );
}

function pick(label: string, ...files: File[]) {
  fireEvent.change(screen.getByLabelText(label), { target: { files } });
}

describe('ApplePassPanel (#1410)', () => {
  beforeEach(() => {
    mocks.createPassSigner.mockReset().mockResolvedValue(signer);
    mocks.buildApplePass.mockReset().mockResolvedValue({ bytes: Uint8Array.of(0x50, 0x4b), passJson: {} });
    mocks.download.mockReset();
  });

  it('has no axe violations, loads the files and downloads a signed pass', async () => {
    const { container } = open();
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole('button', { name: 'Download Apple Wallet pass' })).toBeDisabled();

    pick('Certificates', new File(['cert'], 'pass.cer'), new File(['wwdr'], 'AppleWWDRCAG4.cer'));
    pick('Private key', new File(['key text'], 'key.pem'));
    expect(await screen.findByTestId('apple-pass-ready')).toHaveTextContent('pass.com.example.menu (team ABCDE12345), valid until 2027-01-02');
    const [keys] = mocks.createPassSigner.mock.calls.at(-1)!;
    expect(keys.certificateFiles).toHaveLength(2);
    expect(keys.privateKeyPem).toBe('key text');

    fireEvent.click(screen.getByRole('button', { name: 'Download Apple Wallet pass' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(Uint8Array.of(0x50, 0x4b), 'url-example.com.pkpass', 'application/vnd.apple.pkpass'));
    const [usedSigner, input] = mocks.buildApplePass.mock.calls[0];
    expect(usedSigner).toBe(signer);
    expect(input.content.title).toBe('Menu');
    expect(input.images['icon.png']).toBeDefined();
  });

  it('says what is wrong with the files', async () => {
    const { WalletPassError } = await import('@/packages/wallet-pass');
    mocks.createPassSigner.mockRejectedValue(new WalletPassError('This private key does not belong to the certificate.'));
    open();
    pick('Certificates', new File(['cert'], 'pass.pem'));
    pick('Private key', new File(['other'], 'other.pem'));
    expect(await screen.findByText('This private key does not belong to the certificate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Apple Wallet pass' })).toBeDisabled();
  });

  it('waits for both kinds of file before loading them', () => {
    open();
    pick('Private key', new File(['key'], 'key.pem'));
    expect(mocks.createPassSigner).not.toHaveBeenCalled();
  });
});
