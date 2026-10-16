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
import { describe, it, expect, vi } from 'vitest';
import { PatternControls } from './PatternControls';
import { DEFAULT_CONFIG } from '../../constants';
import { QRStyle } from '../../types';

describe('PatternControls', () => {
  it('renders with correct accessibility attributes', () => {
    const handleChange = vi.fn();
    render(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    // Check group role and label
    const group = screen.getByRole('radiogroup', { name: /pattern style/i });
    expect(group).toBeInTheDocument();

    // Check radios have aria-labels
    // Scoped to the pattern group: the eye shape groups add their own radios to the page.
    const radios = within(group).getAllByRole('radio');
    radios.forEach(radio => {
      expect(radio).toHaveAttribute('aria-label');
      expect(radio.getAttribute('aria-label')).toMatch(/select .* pattern/i);
    });

    // Check checked state
    const standardRadio = screen.getByLabelText(/select standard industrial pattern/i);
    expect(standardRadio).toBeChecked();
  });

  it('shows the pattern warning as a static note that screen readers are not interrupted by', () => {
    // The scannability verdict already announces "Scans, but fragile" for these patterns (#800),
    // so the pattern warning is visible but never a second live announcement.
    const handleChange = vi.fn();
    const { rerender } = render(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    rerender(<PatternControls config={{ ...DEFAULT_CONFIG, style: QRStyle.GRUNGE }} onChange={handleChange} />);
    expect(screen.getByRole('note')).toHaveTextContent(/Scannability Warning: The selected pattern \("Grunge"\) is complex and may reduce scannability/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-live]')).not.toBeInTheDocument();

    rerender(<PatternControls config={{ ...DEFAULT_CONFIG, style: QRStyle.CIRCUIT }} onChange={handleChange} />);
    expect(screen.getByRole('note')).toHaveTextContent(/Scannability Warning: The selected pattern \("Cyber Circuit"\) is complex and may reduce scannability/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders the eye frame and ball shape groups inside the pattern controls', () => {
    render(<PatternControls config={DEFAULT_CONFIG} onChange={vi.fn()} />);

    const patternControls = screen.getByRole('heading', { name: 'Pattern Style' }).parentElement;
    expect(patternControls).not.toBeNull();
    expect(patternControls).toContainElement(screen.getByRole('radiogroup', { name: 'Eye frame shape' }));
    expect(patternControls).toContainElement(screen.getByRole('radiogroup', { name: 'Eye ball shape' }));
  });
});
