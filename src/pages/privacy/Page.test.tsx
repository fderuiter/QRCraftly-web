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
import { axe } from 'vitest-axe';
import Page from './+Page';

describe('App privacy policy page', () => {
  it('names the native app and shows the effective date', () => {
    render(<Page />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'QRCraftly for iPhone, iPad and Mac: Privacy Policy' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Effective date:/)).toHaveTextContent('Effective date: October 4, 2026');
    expect(screen.getByText(/Last updated:/)).toHaveTextContent('Last updated: October 4, 2026');
    expect(screen.getByText(/makes no network connections/)).toBeInTheDocument();
  });

  it('sends readers to the support page for contact', () => {
    render(<Page />);
    expect(screen.getByRole('link', { name: 'support page' })).toHaveAttribute('href', '/support');
  });

  it('has a single h1, ordered headings and no axe violations', async () => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'What QRCraftly does with your information',
      'Permissions',
    ]);
    expect(await axe(container)).toHaveNoViolations();
  });
});
