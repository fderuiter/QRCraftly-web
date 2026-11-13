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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePicker, type PickedFile } from './FilePicker';

/** A promise the test settles by hand, so a read can finish after a newer one. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A file whose arrayBuffer() is controlled by the test. */
function controlledFile(name: string, read: () => Promise<ArrayBuffer>) {
  const file = new File(['key'], name, { type: 'application/x-pem-file' });
  const arrayBuffer = vi.fn(read);
  file.arrayBuffer = arrayBuffer;
  return { file, arrayBuffer };
}

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

/** Lets pending file reads settle without any timers. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
}

const KEY_INPUT = 'Signing key';

function renderPicker(multiple: boolean, onPick: (files: PickedFile[]) => void) {
  return render(
    <FilePicker label={KEY_INPUT} hint="h" accept=".pem" multiple={multiple} files={[]} onPick={onPick} />
  );
}

function pick(files: File[]) {
  fireEvent.change(screen.getByLabelText(KEY_INPUT), { target: { files } });
}

describe('FilePicker latest pick wins (#1705)', () => {
  it('hands on only the newest pick when an older read finishes last', async () => {
    const olderRead = deferred<ArrayBuffer>();
    const a = controlledFile('a.pem', () => olderRead.promise);
    const b = controlledFile('b.pem', () => Promise.resolve(bytesOf('bee')));
    const onPick = vi.fn<(files: PickedFile[]) => void>();
    renderPicker(false, onPick);

    pick([a.file]);
    await waitFor(() => expect(a.arrayBuffer).toHaveBeenCalled());
    pick([b.file]);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));

    olderRead.resolve(bytesOf('ay'));
    await flush();

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].map((file) => file.name)).toEqual(['b.pem']);
  });

  it('hands on only the newest multiple-file pick, whole, when an older pick finishes last', async () => {
    const olderSecond = deferred<ArrayBuffer>();
    const a1 = controlledFile('a1.pem', () => Promise.resolve(bytesOf('a1')));
    const a2 = controlledFile('a2.pem', () => olderSecond.promise);
    const b1 = controlledFile('b1.pem', () => Promise.resolve(bytesOf('b1')));
    const b2 = controlledFile('b2.pem', () => Promise.resolve(bytesOf('b2')));
    const onPick = vi.fn<(files: PickedFile[]) => void>();
    renderPicker(true, onPick);

    pick([a1.file, a2.file]);
    await waitFor(() => expect(a2.arrayBuffer).toHaveBeenCalled());
    pick([b1.file, b2.file]);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));

    olderSecond.resolve(bytesOf('a2'));
    await flush();

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].map((file) => file.name)).toEqual(['b1.pem', 'b2.pem']);
  });

  it('shows an alert and hands on nothing when the current pick cannot be read', async () => {
    const broken = controlledFile('broken.pem', () => Promise.reject(new Error('unreadable')));
    const onPick = vi.fn<(files: PickedFile[]) => void>();
    renderPicker(false, onPick);

    pick([broken.file]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read/i);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows no alert when an older pick fails after a newer pick succeeded', async () => {
    const olderRead = deferred<ArrayBuffer>();
    const a = controlledFile('a.pem', () => olderRead.promise);
    const b = controlledFile('b.pem', () => Promise.resolve(bytesOf('bee')));
    const onPick = vi.fn<(files: PickedFile[]) => void>();
    renderPicker(false, onPick);

    pick([a.file]);
    await waitFor(() => expect(a.arrayBuffer).toHaveBeenCalled());
    pick([b.file]);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));

    olderRead.reject(new Error('unreadable'));
    await flush();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('hands on nothing when the picker unmounts while a read is pending', async () => {
    const pending = deferred<ArrayBuffer>();
    const a = controlledFile('a.pem', () => pending.promise);
    const onPick = vi.fn<(files: PickedFile[]) => void>();
    const { unmount } = renderPicker(false, onPick);

    pick([a.file]);
    await waitFor(() => expect(a.arrayBuffer).toHaveBeenCalled());
    unmount();

    pending.resolve(bytesOf('key'));
    await flush();

    expect(onPick).not.toHaveBeenCalled();
  });
});
