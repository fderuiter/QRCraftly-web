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
import { axe } from 'vitest-axe';
import shippedPackages, { licensesFile } from 'virtual:shipped-packages';
import Page from './+Page';

describe('Acknowledgements page', () => {
  it('lists every shipped package with its version and license', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: 'Open-source acknowledgements' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(shippedPackages.length);
    for (const pkg of shippedPackages) {
      const row = within(table).getByText(pkg.name).closest('tr') as HTMLElement;
      expect(within(row).getByText(pkg.version)).toBeInTheDocument();
      expect(within(row).getByText(pkg.license)).toBeInTheDocument();
    }
    for (const pkg of ['react', 'react-dom', 'vike']) {
      expect(shippedPackages.some((candidate) => candidate.name === pkg)).toBe(true);
    }
  });

  it('links each package to its source and the page to the full license texts', () => {
    render(<Page />);
    expect(screen.getByRole('link', { name: 'react' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/github\.com\//));
    expect(screen.getByRole('link', { name: 'third-party-licenses.txt' })).toHaveAttribute('href', licensesFile);
    expect(licensesFile).toBe('/third-party-licenses.txt');
  });

  it('has a single h1, ordered headings and no axe violations', async () => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
    expect(await axe(container)).toHaveNoViolations();
  });
});
