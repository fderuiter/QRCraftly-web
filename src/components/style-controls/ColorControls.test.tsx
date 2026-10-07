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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ColorControls } from './ColorControls';
import { DEFAULT_CONFIG } from '../../constants';

describe('ColorControls', () => {
  it('renders with correct accessibility attributes', () => {
    const handleChange = vi.fn();
    render(<ColorControls config={DEFAULT_CONFIG} onChange={handleChange} />);

    // Check group role and label
    const group = screen.getByRole('radiogroup', { name: /color presets/i });
    expect(group).toBeInTheDocument();

    // Check preset radios have aria-labels
    // Note: ColorControls renders other buttons/inputs too, so we filter by the preset group
    // Ideally we query within the group
    const presetsGroup = screen.getByRole('radiogroup', { name: /color presets/i });
    const presetRadios = within(presetsGroup).getAllByRole('radio');

    expect(presetRadios.length).toBeGreaterThan(0);
    presetRadios.forEach(radio => {
      expect(radio).toHaveAttribute('aria-label');
      expect(radio.getAttribute('aria-label')).toMatch(/select .* theme/i);
    });
  });

  it('checks the preset that matches the current colours and applies a preset on click', async () => {
    const handleChange = vi.fn();
    render(<ColorControls config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' }} onChange={handleChange} />);
    const classic = screen.getByRole('radio', { name: /select classic theme/i });
    expect(classic).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /select midnight theme/i }));
    expect(handleChange).toHaveBeenCalledWith({
      fgColor: '#f8fafc',
      bgColor: '#020617',
      eyeColor: '#38bdf8',
      eyeFrameColor: '#38bdf8',
      eyeBallColor: '#38bdf8',
    });
  });

  it('allows updating eye frame and eye ball colors independently', () => {
    const handleChange = vi.fn();
    render(<ColorControls config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' }} onChange={handleChange} />);

    const eyeFrameInput = screen.getByLabelText('Eye Frame');
    fireEvent.change(eyeFrameInput, { target: { value: '#ff0000' } });
    expect(handleChange).toHaveBeenCalledWith({ eyeFrameColor: '#ff0000' });

    const eyeBallInput = screen.getByLabelText('Eye Ball');
    fireEvent.change(eyeBallInput, { target: { value: '#00ff00' } });
    expect(handleChange).toHaveBeenCalledWith({ eyeBallColor: '#00ff00' });
  });

  it('triggers low contrast warning when either eye frame or eye ball color has low contrast against background', () => {
    const handleChange = vi.fn();

    // Low contrast eye frame (#ffffff on #ffffff)
    const { rerender } = render(
      <ColorControls
        config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff', eyeFrameColor: '#ffffff', eyeBallColor: '#000000' }}
        onChange={handleChange}
      />
    );
    expect(screen.getByText(/Warning: The contrast ratio is low/i)).toBeInTheDocument();

    // Low contrast eye ball (#ffffff on #ffffff)
    rerender(
      <ColorControls
        config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff', eyeFrameColor: '#000000', eyeBallColor: '#ffffff' }}
        onChange={handleChange}
      />
    );
    expect(screen.getByText(/Warning: The contrast ratio is low/i)).toBeInTheDocument();
  });

  it('keeps one tab stop and no checked radio for custom colours', () => {
    render(<ColorControls config={{ ...DEFAULT_CONFIG, fgColor: '#123456', bgColor: '#fefefe', eyeColor: '#123456' }} onChange={vi.fn()} />);
    const radios = within(screen.getByRole('radiogroup', { name: /color presets/i })).getAllByRole('radio');
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('toggles transparent background and disables background color input', () => {
    const handleChange = vi.fn();
    render(<ColorControls config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff' }} onChange={handleChange} />);

    const bgInput = screen.getByLabelText('Background');
    expect(bgInput).not.toBeDisabled();

    const checkbox = screen.getByRole('checkbox', { name: /transparent background/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(handleChange).toHaveBeenCalledWith({ bgColor: 'transparent' });
  });

  it('renders disabled background input and checked toggle when bgColor is transparent', () => {
    const handleChange = vi.fn();
    render(<ColorControls config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: 'transparent' }} onChange={handleChange} />);

    const bgInput = screen.getByLabelText('Background');
    expect(bgInput).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', { name: /transparent background/i });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(handleChange).toHaveBeenCalledWith({ bgColor: '#ffffff' });
  });

  it('evaluates contrast ratio against white fallback when bgColor is transparent', () => {
    const handleChange = vi.fn();

    // White foreground on transparent background (evaluated against #ffffff -> low contrast)
    const { rerender } = render(
      <ColorControls
        config={{ ...DEFAULT_CONFIG, fgColor: '#ffffff', bgColor: 'transparent' }}
        onChange={handleChange}
      />
    );
    expect(screen.getByText(/Warning: The contrast ratio is low/i)).toBeInTheDocument();

    // Black foreground on transparent background (evaluated against #ffffff -> high contrast)
    rerender(
      <ColorControls
        config={{ ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: 'transparent' }}
        onChange={handleChange}
      />
    );
    expect(screen.queryByText(/Warning: The contrast ratio is low/i)).not.toBeInTheDocument();
  });
});
