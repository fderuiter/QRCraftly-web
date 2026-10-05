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
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { navigate } from 'vike/client/router';
import LayoutDefault from '@/layouts/LayoutDefault';
import Page from './+Page';
import config from './+config';
import { getMetadataForPath } from '@/data/contentRegistry';
import { useQrScanner, type UseQrScannerOptions } from '@/packages/optical-scanner/client';
import { getPageSchema } from '@/data/pageContent';
import { withPageContent } from '../../../tests/utils/pageContent';

vi.mock('vike/client/router', () => ({ navigate: vi.fn(() => Promise.resolve()) }));
vi.mock('@/packages/optical-scanner/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/optical-scanner/client')>();
  return { ...actual, useQrScanner: vi.fn(actual.useQrScanner) };
});

describe('/qr-code-scanner page (#1034)', () => {
  it('renders in the default layout without asking for the camera on load', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    window.history.replaceState(null, '', '/qr-code-scanner');
    const { container } = render(
      <LayoutDefault>{withPageContent('/qr-code-scanner', <Page />)}</LayoutDefault>
    );
    expect(screen.getByRole('heading', { level: 1, name: 'QR Code Scanner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start camera' })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders the how-to, privacy, FAQ and related links with structured data', () => {
    render(withPageContent('/qr-code-scanner', <Page />));
    expect(screen.getByRole('heading', { name: 'How to Scan a QR Code Online' })).toBeInTheDocument();
    expect(screen.getByText('Nothing uploaded')).toBeInTheDocument();
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make your own QR code' })).toHaveAttribute('href', '/');
    const jsonLd = JSON.stringify(getPageSchema('/qr-code-scanner'));
    expect(jsonLd).toContain('WebApplication');
    expect(jsonLd).toContain('FAQPage');
  });

  it('opens a scanned code in the generator for its type without putting it in the URL', async () => {
    render(withPageContent('/qr-code-scanner', <Page />));
    const options: UseQrScannerOptions | undefined = vi.mocked(useQrScanner).mock.lastCall?.[0];
    await act(async () => {
      options?.onScanSuccess?.('WIFI:T:WPA;S:Home;P:secret;;', { text: 'x', bytes: null, corners: null, source: 'qr-decode', durationMs: 0 });
    });
    act(() => {
      screen.getByRole('button', { name: 'Open in generator' }).click();
    });
    expect(navigate).toHaveBeenCalledWith('/wifi-qr-code');
    expect(vi.mocked(navigate).mock.lastCall?.[0]).not.toContain('Home');
  });

  it('is prerendered with an accurate title and description', () => {
    expect(config.prerender).toBe(true);
    const meta = getMetadataForPath('/qr-code-scanner');
    expect(meta.title).toMatch(/QR Code Scanner/);
    expect(meta.description).toMatch(/nothing is uploaded/);
  });
});
