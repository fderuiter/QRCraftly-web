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

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Page from './+Page';
import { PLEDGE_COLLECTED, PLEDGE_COMMITMENT, PLEDGE_HEADLINE, PLEDGE_NOT_COLLECTED, PLEDGE_PROMISES } from '@/data/pledge';

describe('Free Forever (pledge) Page', () => {
  it('states the no-ads pledge as the page heading', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: PLEDGE_HEADLINE })).toBeInTheDocument();
    expect(screen.getByText(PLEDGE_COMMITMENT)).toBeInTheDocument();
  });

  it('lists every promise', () => {
    render(<Page />);
    for (const promise of PLEDGE_PROMISES) {
      expect(screen.getByRole('heading', { level: 3, name: promise.title })).toBeInTheDocument();
    }
  });

  it('lists exactly what is and is not collected, including what Cloudflare sees', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: /What is seen or stored/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /What is never collected/i })).toBeInTheDocument();
    for (const item of [...PLEDGE_COLLECTED, ...PLEDGE_NOT_COLLECTED]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getByText(/Cloudflare, which hosts the site/i)).toBeInTheDocument();
  });

  it('links the AGPL source code', () => {
    render(<Page />);
    expect(screen.getByRole('link', { name: /source code on GitHub/i })).toHaveAttribute('href', 'https://github.com/fderuiter/QRCraftly-web');
  });

  it('has no donation or ad links', () => {
    const { container } = render(<Page />);
    expect(container.innerHTML).not.toMatch(/ko-fi|buymeacoffee|patreon/i);
  });

  it('has a single h1 and ordered heading levels', () => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const main = container;
    const levels = Array.from(main.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });
});
