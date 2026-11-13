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

import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VCardFileImport } from './VCardFileImport';
import { useLatestSelection, type LatestSelection } from '@/hooks/useLatestSelection';
import type { VCardData } from '@/packages/qr-payload';

type Fields = Omit<VCardData, 'version'>;

const alice = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Alpha;Ann;;;\r\nFN:Ann Alpha\r\nEND:VCARD\r\n';
const bob = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Beta;Ben;;;\r\nFN:Ben Beta\r\nEND:VCARD\r\n';

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

/** A .vcf file whose text() is controlled by the test. */
function controlledFile(name: string, text: () => Promise<string>) {
  const file = new File(['unused'], name, { type: 'text/vcard' });
  const read = vi.fn(text);
  file.text = read;
  return { file, read };
}

/** Lets pending dynamic imports and file reads settle without any timers. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('Contact card file (.vcf)'), { target: { files: [file] } });
}

const statusText = () => screen.getByRole('status').textContent;

describe('VCardFileImport latest file wins (#1705)', () => {
  it('applies only the newest file when an older read finishes last', async () => {
    const older = deferred<string>();
    const a = controlledFile('a.vcf', () => older.promise);
    const b = controlledFile('b.vcf', () => Promise.resolve(bob));
    const onImport = vi.fn<(fields: Fields) => void>();
    render(<VCardFileImport onImport={onImport} />);

    pick(a.file);
    await waitFor(() => expect(a.read).toHaveBeenCalled());
    pick(b.file);
    await waitFor(() => expect(statusText()).toContain('Filled in from b.vcf'));

    older.resolve(alice);
    await flush();

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toMatchObject({ firstName: 'Ben', lastName: 'Beta' });
    expect(statusText()).toBe('Filled in from b.vcf. Check the fields before you download.');
  });

  it('shows no error when an older read rejects after a newer file succeeded', async () => {
    const older = deferred<string>();
    const a = controlledFile('a.vcf', () => older.promise);
    const b = controlledFile('b.vcf', () => Promise.resolve(bob));
    const onImport = vi.fn<(fields: Fields) => void>();
    render(<VCardFileImport onImport={onImport} />);

    pick(a.file);
    await waitFor(() => expect(a.read).toHaveBeenCalled());
    pick(b.file);
    await waitFor(() => expect(statusText()).toContain('Filled in from b.vcf'));

    older.reject(new Error('read failed'));
    await flush();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(statusText()).toContain('Filled in from b.vcf');
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the file is still being read as the form unmounts', async () => {
    const pending = deferred<string>();
    const a = controlledFile('a.vcf', () => pending.promise);
    const onImport = vi.fn<(fields: Fields) => void>();
    const errorSpy = vi.spyOn(console, 'error');
    const { unmount } = render(<VCardFileImport onImport={onImport} />);

    pick(a.file);
    await waitFor(() => expect(a.read).toHaveBeenCalled());
    unmount();

    pending.resolve(alice);
    await flush();

    expect(onImport).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('drops a file that is still being read once the owner retires it', async () => {
    const pending = deferred<string>();
    const a = controlledFile('a.vcf', () => pending.promise);
    const onImport = vi.fn<(fields: Fields) => void>();

    const Harness = () => {
      const selection: LatestSelection = useLatestSelection();
      return (
        <>
          <button type="button" onClick={selection.retire}>
            Edit by hand
          </button>
          <VCardFileImport onImport={onImport} selection={selection} />
        </>
      );
    };
    render(<Harness />);

    pick(a.file);
    await waitFor(() => expect(a.read).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit by hand' }));

    pending.resolve(alice);
    await flush();

    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still shows an alert for a file that is not a contact card', async () => {
    const onImport = vi.fn<(fields: Fields) => void>();
    render(<VCardFileImport onImport={onImport} />);

    pick(new File(['hello'], 'notes.vcf', { type: 'text/vcard' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a contact card/i);
    expect(onImport).not.toHaveBeenCalled();
  });
});
