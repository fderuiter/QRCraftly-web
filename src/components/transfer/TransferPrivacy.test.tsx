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
import { axe } from '../../../tests/utils/axe';
import { BundleComplete } from './BundleComplete';
import { KeyCodeEntry } from './KeyCodeEntry';

const bytes = (...values: number[]) => new Uint8Array(values);
const files = [
  { name: 'photos/a.jpg', mimeType: 'image/jpeg', size: 2048, data: bytes(1, 2) },
  { name: 'tools/setup.exe', mimeType: 'application/octet-stream', size: 4096, data: bytes(3, 4) },
];

describe('BundleComplete', () => {
  it('lists every file with its size and says all checksums were verified', () => {
    render(<BundleComplete files={files} onSaveFile={vi.fn()} onSaveAll={vi.fn()} onReceiveAnother={vi.fn()} />);
    expect(screen.getAllByTestId('received-file-name').map((node) => node.textContent)).toEqual(['photos/a.jpg', 'tools/setup.exe']);
    expect(screen.getByTestId('bundle-summary')).toHaveTextContent('2 files, 6.0 KB');
    expect(screen.getByTestId('bundle-summary')).toHaveTextContent('SHA-256 verified');
  });

  it('saves a harmless file under its bare name with one click', () => {
    const onSaveFile = vi.fn();
    render(<BundleComplete files={files} onSaveFile={onSaveFile} onSaveAll={vi.fn()} onReceiveAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save photos/a.jpg' }));
    expect(onSaveFile).toHaveBeenCalledWith(files[0].data, 'a.jpg', 'image/jpeg');
  });

  it('asks again before saving a risky file, and only then saves it', () => {
    const onSaveFile = vi.fn();
    render(<BundleComplete files={files} onSaveFile={onSaveFile} onSaveAll={vi.fn()} onReceiveAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save tools/setup.exe' }));
    expect(onSaveFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/can run programs/);
    fireEvent.click(screen.getByRole('button', { name: 'Save tools/setup.exe' }));
    expect(onSaveFile).toHaveBeenCalledWith(files[1].data, 'setup.exe', 'application/octet-stream');
  });

  it('offers the archive and receiving another', () => {
    const onSaveAll = vi.fn();
    const onReceiveAnother = vi.fn();
    render(<BundleComplete files={files} onSaveFile={vi.fn()} onSaveAll={onSaveAll} onReceiveAnother={onReceiveAnother} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save all (.zip)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Receive another file' }));
    expect(onSaveAll).toHaveBeenCalledOnce();
    expect(onReceiveAnother).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = render(<BundleComplete files={files} onSaveFile={vi.fn()} onSaveAll={vi.fn()} onReceiveAnother={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('KeyCodeEntry', () => {
  it('keeps Unlock off until something is typed, then hands the code over', () => {
    const onSubmit = vi.fn();
    render(<KeyCodeEntry onSubmit={onSubmit} accepted={null} />);
    const unlock = screen.getByRole('button', { name: 'Unlock' });
    expect(unlock).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Key code'), { target: { value: 'baba-baba' } });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(onSubmit).toHaveBeenCalledWith('baba-baba');
  });

  it('says whether the last code was readable, in a status region', () => {
    const { rerender } = render(<KeyCodeEntry onSubmit={vi.fn()} accepted={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('eight words');
    rerender(<KeyCodeEntry onSubmit={vi.fn()} accepted />);
    expect(screen.getByRole('status')).toHaveTextContent('Key code accepted');
  });

  it('has no axe violations', async () => {
    const { container } = render(<KeyCodeEntry onSubmit={vi.fn()} accepted={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
