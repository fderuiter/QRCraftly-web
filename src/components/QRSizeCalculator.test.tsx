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

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from '../../tests/utils/axe';
import { QRSizeCalculator, COMMON_WIDTHS_CM } from './QRSizeCalculator';

/**
 * Reads the recommended width once the real encoder has measured the content.
 * @returns The width text, such as "10 cm (4 in)".
 */
async function recommendedWidth(): Promise<string> {
  return (await screen.findByTestId('recommended-width')).textContent ?? '';
}

/**
 * Parses the centimetres out of a width such as "10.3 cm (4.1 in)".
 * @param text - The width text.
 * @returns The centimetres.
 */
function centimetres(text: string): number {
  return Number.parseFloat(text);
}

describe('QRSizeCalculator', () => {
  it('measures the sample link and gives a width with inches', async () => {
    render(<QRSizeCalculator />);
    expect(await recommendedWidth()).toMatch(/^\d+(\.\d)? cm \(\d+(\.\d)? in\)$/);
    expect(screen.getByText(/version \d+ code, \d+ squares across/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(COMMON_WIDTHS_CM.length + 1);
  });

  it('asks for a wider code when the content is longer', async () => {
    render(<QRSizeCalculator />);
    const short = centimetres(await recommendedWidth());
    fireEvent.change(screen.getByLabelText('What the code will hold'), {
      target: { value: `https://example.com/${'long-path-segment/'.repeat(12)}` },
    });
    const long = centimetres(await recommendedWidth());
    expect(long).toBeGreaterThan(short);
  });

  it('asks for a wider code when people stand further away', async () => {
    render(<QRSizeCalculator />);
    const near = centimetres(await recommendedWidth());
    fireEvent.change(screen.getByLabelText('Scan distance'), { target: { value: '500' } });
    expect(centimetres(await recommendedWidth())).toBeGreaterThan(near);
  });

  it('asks for content when the box is empty', async () => {
    render(<QRSizeCalculator />);
    await recommendedWidth();
    fireEvent.change(screen.getByLabelText('What the code will hold'), { target: { value: '' } });
    expect(screen.getByText(/Type or paste what the code will hold/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says when the content is too long for one code', async () => {
    render(<QRSizeCalculator />);
    await recommendedWidth();
    fireEvent.change(screen.getByLabelText('What the code will hold'), { target: { value: 'x'.repeat(4000) } });
    expect(screen.getByText(/more than one QR code can hold/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<QRSizeCalculator />);
    await recommendedWidth();
    expect(await axe(container)).toHaveNoViolations();
  });
});
