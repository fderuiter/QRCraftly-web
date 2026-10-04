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

describe('App support page', () => {
  it('names the native app and links to its privacy policy', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: 'QRCraftly for iPhone, iPad and Mac: Support' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy');
  });

  it('shows the contact placeholder until an address is chosen', () => {
    render(<Page />);
    expect(screen.getByText(/YOUR_EMAIL/)).toBeInTheDocument();
  });

  it('has a single h1 and no axe violations', async () => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});
