/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { describe, it, expect } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import Page from './+Page';

describe('About Page', () => {
  it('renders the About page content', () => {
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: /About QRCraftly/i })).toBeInTheDocument();
    expect(screen.getByText(/A QR code generator that runs in your browser/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeInTheDocument();
    // Site navigation and the footer come from the app shell, never from the page.
    expect(screen.queryByRole('navigation', { name: /Primary navigation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('links to every tool (#1056)', () => {
    const { container } = render(<Page />);
    const tools = container.querySelector('section#tools') as HTMLElement;
    const hrefs = within(tools).getAllByRole('link').map((link) => link.getAttribute('href'));
    for (const href of ['/', '/wifi-qr-code', '/bulk-csv-qr-code', '/file-transfer', '/file-transfer/receive', '/arcade']) {
      expect(hrefs).toContain(href);
    }
    expect(screen.getByRole('link', { name: /WiFi QR Code/i })).toHaveAttribute('href', '/wifi-qr-code');
  });

  it('has a single h1, no "About About" heading and ordered h2/h3 levels', () => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /About About/i })).not.toBeInTheDocument();

    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('does not repeat copy, uses one accent and has no axe violations', async () => {
    const { container } = render(<Page />);
    expect(screen.getAllByText(/It costs nothing and needs no account/i)).toHaveLength(1);
    expect(screen.getAllByText(/check the claims on this site against it/i)).toHaveLength(1);
    expect(container.innerHTML).not.toMatch(/indigo|amber|rose|text-center|(?:bg|text|border)-(?:slate|teal)-\d/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
