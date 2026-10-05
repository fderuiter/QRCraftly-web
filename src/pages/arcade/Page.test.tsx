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
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LayoutDefault from '@/layouts/LayoutDefault';
import Page from './+Page';
import config from './+config';
import { getMetadataForPath } from '@/data/contentRegistry';
import { getPageSchema } from '@/data/pageContent';
import { withPageContent } from '../../../tests/utils/pageContent';

vi.mock('vike/client/router', () => ({ navigate: vi.fn(() => Promise.resolve()) }));

describe('/arcade page', () => {
  it('renders inside the default layout with the skip link, primary navigation and theme toggle', () => {
    window.history.replaceState(null, '', '/arcade');
    render(
      <LayoutDefault>{withPageContent('/arcade', <Page />)}</LayoutDefault>
    );
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'QR Arcade & Durability Lab' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Theme: / }).length).toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(nav.querySelector('a[href="/arcade"]')).toHaveAttribute('aria-current', 'page');
    // No forced dark wrapper: theming comes from the global ThemeProvider.
    expect(document.querySelector('.dark')).toBeNull();
  });

  it('renders the how-to and FAQ content and structured data', () => {
    render(withPageContent('/arcade', <Page />));
    expect(screen.getByRole('heading', { name: 'How to Stress-Test a QR Code in the QR Arcade' })).toBeInTheDocument();
    expect(screen.getByText('Frequently Asked Questions')).toBeInTheDocument();
    const jsonLd = JSON.stringify(getPageSchema('/arcade'));
    expect(jsonLd).toContain('WebApplication');
    expect(jsonLd).toContain('HowTo');
    expect(jsonLd).toContain('FAQPage');
  });

  it('is prerendered with an accurate title and description', () => {
    expect(config.prerender).toBe(true);
    const meta = getMetadataForPath('/arcade');
    expect(meta.title).toMatch(/QR Arcade/);
    expect(meta.description).toMatch(/Reed-Solomon/);
  });
});
