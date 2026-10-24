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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFileDrop, type FileDropOptions } from './useFileDrop';

function DropZone(options: FileDropOptions) {
  const { isDragging, inputRef, dropProps, inputProps, browseProps } = useFileDrop(options);
  return (
    <div data-testid="zone" data-dragging={isDragging} {...dropProps} {...browseProps}>
      <span data-testid="child">Drop here</span>
      <input data-testid="input" ref={inputRef} {...inputProps} />
    </div>
  );
}

const fileOf = (name: string) => new File(['x'], name, { type: 'video/mp4' });

describe('useFileDrop', () => {
  it('highlights while dragging and takes the dropped file', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [], dropEffect: 'none' } });
    expect(zone).toHaveAttribute('data-dragging', 'true');
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('a.mp4'), fileOf('b.mp4')] } });
    expect(zone).toHaveAttribute('data-dragging', 'false');
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.mp4' })]);
  });

  it('passes every file when several are allowed', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} multiple />);
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: { files: [fileOf('a.mp4'), fileOf('b.mp4')] } });
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });

  it('keeps the highlight when the drag moves onto a child, and drops it on leaving', () => {
    render(<DropZone onFiles={vi.fn()} />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
    // A real MouseEvent carries relatedTarget, which the drag event helpers drop.
    fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget: screen.getByTestId('child') }));
    expect(zone).toHaveAttribute('data-dragging', 'true');
    fireEvent(zone, new MouseEvent('dragleave', { bubbles: true, relatedTarget: document.body }));
    expect(zone).toHaveAttribute('data-dragging', 'false');
  });

  it('ignores drags and drops while disabled', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} disabled />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveAttribute('data-dragging', 'false');
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('a.mp4')] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('takes a picked file and clears the input so the same file can be picked twice', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} accept="video/*" />);
    const input = screen.getByTestId<HTMLInputElement>('input');
    expect(input).toHaveAttribute('accept', 'video/*');
    fireEvent.change(input, { target: { files: [fileOf('a.mp4')] } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { files: [fileOf('a.mp4')] } });
    expect(onFiles).toHaveBeenCalledTimes(2);
  });

  it('ignores an empty pick', () => {
    const onFiles = vi.fn();
    render(<DropZone onFiles={onFiles} />);
    fireEvent.change(screen.getByTestId('input'), { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it.each(['Enter', ' '])('opens the picker with %j and with a click', (key) => {
    render(<DropZone onFiles={vi.fn()} />);
    const click = vi.spyOn(screen.getByTestId<HTMLInputElement>('input'), 'click').mockImplementation(() => {});
    fireEvent.keyDown(screen.getByTestId('zone'), { key });
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId('zone'), { key: 'a' });
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('zone'));
    expect(click).toHaveBeenCalledTimes(2);
  });
});
