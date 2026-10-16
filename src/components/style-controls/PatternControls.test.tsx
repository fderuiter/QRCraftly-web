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
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { PatternControls } from './PatternControls';
import { DEFAULT_CONFIG } from '../../constants';
import { QRStyle } from '../../types';

describe('PatternControls', () => {
  it('renders with correct accessibility attributes', () => {
    const handleChange = vi.fn();
    render(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    // Check group role and labels for Pattern Style, Frame Shape, and Eyeball Shape
    const patternGroup = screen.getByRole('radiogroup', { name: /^pattern style$/i });
    expect(patternGroup).toBeInTheDocument();

    const frameGroup = screen.getByRole('radiogroup', { name: /^frame shape$/i });
    expect(frameGroup).toBeInTheDocument();

    const ballGroup = screen.getByRole('radiogroup', { name: /^eyeball shape$/i });
    expect(ballGroup).toBeInTheDocument();

    // Check radios have aria-labels
    const radios = screen.getAllByRole('radio');
    radios.forEach((radio) => {
      expect(radio).toHaveAttribute('aria-label');
      expect(radio.getAttribute('aria-label')).toMatch(/select .* (pattern|frame shape|eyeball shape)/i);
    });

    // Check checked state
    const standardRadio = screen.getByLabelText(/select standard industrial pattern/i);
    expect(standardRadio).toBeChecked();
  });

  it('allows changing frame shape and eyeball shape', async () => {
    const handleChange = vi.fn();
    render(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    const modernFrameRadio = screen.getByRole('radio', { name: /select rounded frame shape/i });
    await userEvent.click(modernFrameRadio);
    expect(handleChange).toHaveBeenCalledWith({ eyeFrameStyle: QRStyle.MODERN });

    const swissBallRadio = screen.getByRole('radio', { name: /select circle eyeball shape/i });
    await userEvent.click(swissBallRadio);
    expect(handleChange).toHaveBeenCalledWith({ eyeBallStyle: QRStyle.SWISS });
  });

  it('toggles individual eye styling and allows setting per-eye overrides', async () => {
    const handleChange = vi.fn();
    const { rerender } = render(<PatternControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    const toggle = screen.getByLabelText(/customize individual eyes/i);
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(handleChange).toHaveBeenCalledWith({
      eyeOverrides: {
        'top-left': {},
        'top-right': {},
        'bottom-left': {},
      },
    });

    // Rerender with eyeOverrides enabled
    rerender(
      <PatternControls
        config={{
          ...DEFAULT_CONFIG,
          eyeOverrides: {
            'top-left': {},
            'top-right': {},
            'bottom-left': {},
          },
        }}
        onChange={handleChange}
      />
    );

    const individualControls = screen.getByTestId('individual-eye-controls');
    expect(individualControls).toBeInTheDocument();

    // Change Top-Left Frame Shape to Modern (Rounded)
    const topLeftFrameRadio = screen.getByRole('radio', { name: /select rounded for top-left eye frame/i });
    await userEvent.click(topLeftFrameRadio);
    expect(handleChange).toHaveBeenCalledWith({
      eyeOverrides: {
        'top-left': { frameStyle: QRStyle.MODERN },
        'top-right': {},
        'bottom-left': {},
      },
    });
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
});
