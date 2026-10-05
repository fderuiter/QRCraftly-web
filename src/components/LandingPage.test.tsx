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

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import LayoutDefault from '@/layouts/LayoutDefault';
import { LandingPage } from '@/components/LandingPage';
import { clearRetainedAppearance } from '@/context/QRContext';
import { getMetadataForPath } from '@/data/contentRegistry';
import { LANDING_PRESETS } from '@/data/landingPages';
import { QRErrorCorrectionLevel } from '@/types';
import { withPageContent } from '../../tests/utils/pageContent';

function renderLanding(id: string) {
  window.history.replaceState(null, '', `/${id}`);
  return render(
    <LayoutDefault>{withPageContent(`/${id}`, <LandingPage id={id} />)}</LayoutDefault>
  );
}

const logoButton = () => screen.getByRole('button', { name: 'Logo' });

describe('landing pages that preset the generator (#1035, #1037)', () => {
  // One test per page: three full generator renders in one test can pass 15 s on a busy runner.
  it.each([
    ['mosaic-qr-code', 'true'],
    ['qr-code-with-logo', 'true'],
    ['menu-qr-code', 'false'],
  ] as const)('sets the Logo section of %s to aria-expanded=%s', (id, expanded) => {
    clearRetainedAppearance();
    renderLanding(id);
    expect(logoButton()).toHaveAttribute('aria-expanded', expanded);
  });

  it('sets high error correction on the logo and mosaic pages, even after another route changed it', () => {
    expect(LANDING_PRESETS['qr-code-with-logo'].presetConfig?.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.H);
    expect(LANDING_PRESETS['mosaic-qr-code'].presetConfig?.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.H);
    clearRetainedAppearance();
    renderLanding('qr-code-with-logo');
    expect(screen.getByRole('heading', { level: 1, name: 'Free QR Code Generator with Logo' })).toBeInTheDocument();
  });

  it('starts the WhatsApp page on a wa.me link and the Instagram page on a handle field', () => {
    clearRetainedAppearance();
    const whatsapp = renderLanding('whatsapp-qr-code');
    expect(screen.getByRole('textbox', { name: /url/i })).toHaveValue('https://wa.me/');
    whatsapp.unmount();
    clearRetainedAppearance();
    renderLanding('instagram-qr-code');
    expect(screen.getByLabelText('Username / Handle')).toBeInTheDocument();
  });

  it('shows the mosaic gallery with alt text, and the guide, how-to and FAQ on every page', () => {
    clearRetainedAppearance();
    renderLanding('mosaic-qr-code');
    const gallery = screen.getByRole('region', { name: 'Examples' });
    const images = within(gallery).getAllByRole('img');
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.getAttribute('alt')?.length).toBeGreaterThan(20);
    expect(screen.getByRole('heading', { name: 'How to Make an Image QR Code' })).toBeInTheDocument();
    expect(screen.getByText('Is this an AI QR code?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy: where your data goes' })).toBeInTheDocument();
  });

  it('links each landing page to the next ones and has accurate metadata', () => {
    clearRetainedAppearance();
    renderLanding('pdf-qr-code');
    expect(screen.getByRole('link', { name: 'Image QR Code Generator' })).toHaveAttribute('href', '/mosaic-qr-code');
    const meta = getMetadataForPath('/pdf-qr-code');
    expect(meta.title).toMatch(/PDF QR Code/);
    expect(meta.description).toMatch(/do not host/);
  });

  it('has no axe violations on the mosaic page', async () => {
    clearRetainedAppearance();
    const { container } = renderLanding('mosaic-qr-code');
    expect(await axe(container)).toHaveNoViolations();
  });
});
