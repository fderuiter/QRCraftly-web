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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRType } from '@/packages/core/types';
import { ToastProvider } from '../ui/Toast';
import GooglePassPanel from './GooglePassPanel';

const build = vi.hoisted(() => vi.fn());
vi.mock('@/packages/wallet-pass', async (original) => ({
  ...(await original<typeof import('@/packages/wallet-pass')>()),
  buildGoogleSaveLink: build,
}));

const KEY_FILE = JSON.stringify({ type: 'service_account', client_email: 'wallet@example.iam.gserviceaccount.com', private_key: 'key' });

function open() {
  return render(
    <ToastProvider>
      <GooglePassPanel config={{ ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://example.com' }} title="Menu" subtitle="" />
    </ToastProvider>
  );
}

describe('GooglePassPanel (#1411)', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    build.mockReset().mockResolvedValue({ url: 'https://pay.google.com/gp/v/save/a.b.c', jwt: 'a.b.c' });
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });
  afterEach(() => openSpy.mockRestore());

  it('has no axe violations, and asks before sending the pass to Google', async () => {
    const { container } = open();
    expect(await axe(container)).toHaveNoViolations();
    const save = screen.getByRole('button', { name: 'Save to Google Wallet' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Service-account key'), { target: { files: [new File([KEY_FILE], 'key.json')] } });
    expect(await screen.findByTestId('google-pass-ready')).toHaveTextContent('wallet@example.iam.gserviceaccount.com');
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Issuer ID'), { target: { value: '3388000000012345678' } });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(screen.getByText(/Google Wallet receives everything on the pass/)).toBeInTheDocument();
    expect(build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google Wallet' }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://pay.google.com/gp/v/save/a.b.c', '_blank', 'noopener,noreferrer'));
    const [account, input] = build.mock.calls[0];
    expect(account.serviceAccountEmail).toBe('wallet@example.iam.gserviceaccount.com');
    expect(input.issuerId).toBe('3388000000012345678');
    expect(input.content.title).toBe('Menu');
  });

  it('says when the file is not a service-account key, and checks the Issuer ID', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Service-account key'), { target: { files: [new File(['{}'], 'other.json')] } });
    expect(await screen.findByText(/not a service-account key file/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Issuer ID'), { target: { value: '12' } });
    expect(screen.getByText(/long number from the Google Pay/)).toBeInTheDocument();
  });

  it('can be cancelled without sending anything', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Service-account key'), { target: { files: [new File([KEY_FILE], 'key.json')] } });
    await screen.findByTestId('google-pass-ready');
    fireEvent.change(screen.getByLabelText('Issuer ID'), { target: { value: '3388000000012345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Google Wallet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Save to Google Wallet' })).toBeInTheDocument();
    expect(build).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
