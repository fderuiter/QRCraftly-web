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

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import Page from './+Page';

describe('Troubleshooting manual and support page', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders the web troubleshooting manual by default with categorized guides and shared links', () => {
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'QRCraftly Web Troubleshooting Manual' })).toBeInTheDocument();

    const webTab = screen.getByRole('tab', { name: 'Web Application' });
    const nativeTab = screen.getByRole('tab', { name: 'iPhone, iPad & Mac App' });
    expect(webTab).toHaveAttribute('aria-selected', 'true');
    expect(nativeTab).toHaveAttribute('aria-selected', 'false');

    expect(screen.getByRole('heading', { level: 2, name: /Camera & browser permissions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /QR generation & Web Worker recovery/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Canvas security & logo export/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Scannability warnings & fixes/i })).toBeInTheDocument();

    expect(screen.getByText(/Google Chrome, Brave, and Microsoft Edge/i)).toBeInTheDocument();
    expect(screen.getByText(/Apple Safari \(macOS\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mozilla Firefox/i)).toBeInTheDocument();
    expect(screen.getByText(/SecurityError: The operation is insecure/i)).toBeInTheDocument();
    expect(screen.getByText(/Use black on white/i)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'fpderuiter+qrcraftly@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:fpderuiter+qrcraftly@gmail.com'
    );
  });

  it('switches between web manual and native iOS app support tabs', () => {
    render(<Page />);

    const webTab = screen.getByRole('tab', { name: 'Web Application' });
    const nativeTab = screen.getByRole('tab', { name: 'iPhone, iPad & Mac App' });
    const webPanel = document.getElementById('web-panel');
    const nativePanel = document.getElementById('native-panel');

    expect(webPanel).not.toHaveAttribute('hidden');
    expect(nativePanel).toHaveAttribute('hidden');

    fireEvent.click(nativeTab);

    expect(nativeTab).toHaveAttribute('aria-selected', 'true');
    expect(webTab).toHaveAttribute('aria-selected', 'false');
    expect(webPanel).toHaveAttribute('hidden');
    expect(nativePanel).not.toHaveAttribute('hidden');

    expect(screen.getByRole('heading', { level: 2, name: /A code won't scan/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /The camera doesn't start/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Camera Transfer is slow or stops/i })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'fpderuiter+qrcraftly@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:fpderuiter+qrcraftly@gmail.com'
    );

    fireEvent.click(webTab);

    expect(webTab).toHaveAttribute('aria-selected', 'true');
    expect(nativeTab).toHaveAttribute('aria-selected', 'false');
    expect(webPanel).not.toHaveAttribute('hidden');
    expect(nativePanel).toHaveAttribute('hidden');
  });

  it('activates the correct tab on deep-link hash navigation', () => {
    window.location.hash = '#camera-transfer';
    const { unmount } = render(<Page />);

    expect(screen.getByRole('tab', { name: 'iPhone, iPad & Mac App' })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('native-panel')).not.toHaveAttribute('hidden');
    unmount();

    window.location.hash = '#worker-stalls';
    render(<Page />);
    expect(screen.getByRole('tab', { name: 'Web Application' })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('web-panel')).not.toHaveAttribute('hidden');

    window.location.hash = '#wont-scan';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByRole('tab', { name: 'iPhone, iPad & Mac App' })).toHaveAttribute('aria-selected', 'true');
  });

  it('has a single h1, ordered headings and no axe violations across both views', async () => {
    const { container } = render(<Page />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }

    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('tab', { name: 'iPhone, iPad & Mac App' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
