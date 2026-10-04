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
import { AppInfoPage } from './AppInfoPage';

describe('AppInfoPage', () => {
  it('renders the title as the only h1, the meta line and the body', () => {
    render(
      <AppInfoPage title="Example" meta="Effective today">
        <p>Body text</p>
      </AppInfoPage>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Example' })).toBeInTheDocument();
    expect(screen.getByText('Effective today')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('leaves out the meta line when none is given', () => {
    const { container } = render(
      <AppInfoPage title="Example">
        <p>Body</p>
      </AppInfoPage>,
    );
    expect(container.querySelectorAll('header p')).toHaveLength(0);
  });
});
