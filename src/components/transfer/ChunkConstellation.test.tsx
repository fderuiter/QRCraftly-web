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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { ChunkConstellation } from './ChunkConstellation';

const eta = (seconds: number | null) => (seconds === null ? '--' : `${seconds} s`);

describe('ChunkConstellation', () => {
  it('draws one dot per chunk and lights the ones that arrived', () => {
    render(<ChunkConstellation total={20} received={5} etaSeconds={9} formatEta={eta} label="Blocks decoded" />);
    const dots = screen.getByTestId('constellation-dots').querySelectorAll('circle');
    expect(dots).toHaveLength(20);
    expect(screen.getByTestId('constellation-dots').querySelectorAll('[data-lit]')).toHaveLength(5);
    expect(screen.getByTestId('constellation-percent')).toHaveTextContent('25%');
    expect(screen.getByTestId('constellation-eta')).toHaveTextContent('9 s');
  });

  it('lights the exact parts of a legacy transfer, in any order', () => {
    render(<ChunkConstellation total={10} received={new Set([0, 7, 9])} etaSeconds={null} formatEta={eta} label="Parts received" />);
    const lit = Array.from(screen.getByTestId('constellation-dots').querySelectorAll('circle')).map((dot) => dot.hasAttribute('data-lit'));
    expect(lit).toEqual([true, false, false, false, false, false, false, true, false, true]);
    expect(screen.getByTestId('constellation-eta')).toHaveTextContent('--');
  });

  it('groups a big transfer into a bounded number of dots and lights a group only when all its parts are in', () => {
    const received = new Set(Array.from({ length: 500 }, (_, index) => index));
    render(<ChunkConstellation total={1000} received={received} etaSeconds={null} formatEta={eta} label="Parts received" />);
    expect(screen.getByTestId('constellation-dots').querySelectorAll('circle').length).toBeLessThanOrEqual(360);
    const lit = screen.getByTestId('constellation-dots').querySelectorAll('[data-lit]').length;
    expect(lit).toBeGreaterThan(150);
    expect(lit).toBeLessThanOrEqual(180);
  });

  it('exposes a named progress bar and announces only at 25% steps', () => {
    const { rerender } = render(<ChunkConstellation total={100} received={10} etaSeconds={null} formatEta={eta} label="Blocks decoded" />);
    expect(screen.getByRole('progressbar', { name: 'Blocks decoded' })).toHaveAttribute('aria-valuenow', '10');
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<ChunkConstellation total={100} received={49} etaSeconds={null} formatEta={eta} label="Blocks decoded" />);
    expect(screen.getByRole('status')).toHaveTextContent('Blocks decoded: 25%');
    rerender(<ChunkConstellation total={100} received={100} etaSeconds={0} formatEta={eta} label="Blocks decoded" />);
    expect(screen.getByRole('status')).toHaveTextContent('Blocks decoded: 100%');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ChunkConstellation total={12} received={3} etaSeconds={4} formatEta={eta} label="Parts received" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
