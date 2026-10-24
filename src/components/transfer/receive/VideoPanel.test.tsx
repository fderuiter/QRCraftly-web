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

// @vitest-environment jsdom
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoPanel, type VideoPanelProps } from './VideoPanel';

/** A drop zone with no file dragged over it. */
const drop = () =>
  ({ isDragging: false, dropProps: {}, browseProps: {}, inputProps: { type: 'file' }, inputRef: createRef<HTMLInputElement>() }) as unknown as VideoPanelProps['drop'];

describe('VideoPanel', () => {
  it('names the picker by its visible text, before and after a video is chosen (#1593)', () => {
    const { rerender } = render(<VideoPanel videoFile={null} drop={drop()} canClear={false} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Select Video File' })).toBeInTheDocument();

    rerender(<VideoPanel videoFile={new File(['mp4'], 'clip.mp4', { type: 'video/mp4' })} drop={drop()} canClear={false} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Replace Video' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select Video File' })).not.toBeInTheDocument();
  });
});
