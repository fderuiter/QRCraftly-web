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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { DevSimulateButton } from './DevSimulateButton';
import { SendDropZone, type SendDropZoneProps } from './SendDropZone';
import { SendPreview } from './SendPreview';
import { SendStatus } from './SendStatus';

const base: SendDropZoneProps = {
  dropProps: {},
  isDragging: false,
  inputRef: { current: null },
  disabled: false,
  selectedLabel: '',
  selectedSize: null,
  several: false,
  folderSupported: false,
  onChange: vi.fn(),
};

describe('SendDropZone', () => {
  it('asks for files until some are chosen, then names them', async () => {
    const { container, rerender } = render(<SendDropZone {...base} />);
    expect(screen.getByText('Choose files or drag & drop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a folder' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    rerender(<SendDropZone {...base} selectedLabel="2 files" selectedSize={2048} several />);
    expect(screen.getByText('Files:')).toBeInTheDocument();
    expect(screen.getAllByText('2 files')).toHaveLength(2);
  });

  it('offers a folder where the browser can pick one, and locks while a stream runs', () => {
    render(<SendDropZone {...base} folderSupported disabled />);
    expect(screen.getByRole('button', { name: 'Send a folder' })).toBeDisabled();
    expect(screen.getByLabelText('Choose a file to send')).toBeDisabled();
    expect(screen.getByLabelText('Choose a folder to send')).toHaveAttribute('webkitdirectory');
  });

  it('opens the folder picker from its button', () => {
    render(<SendDropZone {...base} folderSupported />);
    const folder = screen.getByLabelText('Choose a folder to send');
    const click = vi.spyOn(folder, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Send a folder' }));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('DevSimulateButton', () => {
  it('shows only in development builds', () => {
    render(<DevSimulateButton onSimulate={vi.fn()} disabled={false} />);
    expect(screen.queryAllByRole('button', { name: /Simulate 50MB/ })).toHaveLength(import.meta.env.DEV ? 1 : 0);
  });
});

describe('SendPreview and SendStatus', () => {
  it('sweeps the canvas only while the stream plays', () => {
    const { container, rerender } = render(<SendPreview canvasRef={{ current: null }} hidden={false} tiled={false} playing />);
    expect(container.querySelector('.motion-safe\\:animate-scan-sweep')).not.toBeNull();
    rerender(<SendPreview canvasRef={{ current: null }} hidden tiled playing={false} />);
    expect(container.querySelector('.motion-safe\\:animate-scan-sweep')).toBeNull();
    expect(container.firstElementChild).toHaveClass('hidden');
  });

  it('keeps the live region present and announces a pause', () => {
    const { rerender } = render(<SendStatus showNotice={false} paused={false} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    rerender(<SendStatus showNotice paused />);
    expect(screen.getByTestId('photosensitivity-notice')).toBeInTheDocument();
  });
});
