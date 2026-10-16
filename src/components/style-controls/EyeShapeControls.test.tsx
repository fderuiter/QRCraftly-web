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
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EyeShapeControls } from './EyeShapeControls';
import { DEFAULT_CONFIG } from '../../constants';
import { axe } from '../../../tests/utils/axe';
import { EyeShape, type QRConfig } from '../../types';

const config = (overrides: Partial<QRConfig> = {}): QRConfig => ({ ...DEFAULT_CONFIG, ...overrides });

describe('EyeShapeControls', () => {
  it('renders a frame group and a ball group, each with five options', () => {
    render(<EyeShapeControls config={config()} onChange={vi.fn()} />);

    for (const groupName of ['Eye frame shape', 'Eye ball shape']) {
      const group = screen.getByRole('radiogroup', { name: groupName });
      const radios = within(group).getAllByRole('radio');
      expect(radios).toHaveLength(5);
      for (const option of ['match the pattern', 'Square', 'Rounded', 'Circle', 'Leaf']) {
        expect(within(group).getByRole('radio', { name: new RegExp(option, 'i') })).toBeInTheDocument();
      }
    }
  });

  it('checks Pattern in both groups when no shape is set', () => {
    render(<EyeShapeControls config={config({ eyeFrameShape: undefined, eyeBallShape: undefined })} onChange={vi.fn()} />);

    expect(within(screen.getByRole('radiogroup', { name: 'Eye frame shape' })).getByRole('radio', { name: /match the pattern/i })).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Eye ball shape' })).getByRole('radio', { name: /match the pattern/i })).toBeChecked();
  });

  it('reports only the frame key when Circle is chosen for the frame', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EyeShapeControls config={config()} onChange={onChange} />);

    await user.click(within(screen.getByRole('radiogroup', { name: 'Eye frame shape' })).getByRole('radio', { name: /circle/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ eyeFrameShape: 'circle' });
    expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['eyeFrameShape']);
  });

  it('clears the ball shape when Pattern is chosen again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EyeShapeControls config={config({ eyeBallShape: EyeShape.LEAF })} onChange={onChange} />);

    await user.click(within(screen.getByRole('radiogroup', { name: 'Eye ball shape' })).getByRole('radio', { name: /match the pattern/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ eyeBallShape: undefined });
    expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['eyeBallShape']);
  });

  it('changes the frame and the ball independently', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EyeShapeControls config={config({ eyeFrameShape: EyeShape.SQUARE, eyeBallShape: EyeShape.LEAF })} onChange={onChange} />);

    await user.click(within(screen.getByRole('radiogroup', { name: 'Eye ball shape' })).getByRole('radio', { name: /rounded/i }));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Eye frame shape' })).getByRole('radio', { name: /circle/i }));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, { eyeBallShape: 'rounded' });
    expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['eyeBallShape']);
    expect(onChange).toHaveBeenNthCalledWith(2, { eyeFrameShape: 'circle' });
    expect(Object.keys(onChange.mock.calls[1][0])).toEqual(['eyeFrameShape']);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<EyeShapeControls config={config({ eyeFrameShape: EyeShape.CIRCLE })} onChange={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
