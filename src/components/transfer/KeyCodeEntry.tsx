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


import { useId, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

interface KeyCodeEntryProps {
  /** Hands the typed key code to the receiver. */
  onSubmit: (code: string) => void;
  /** Whether the last code was readable: null before one was entered. */
  accepted: boolean | null;
}

/**
 * Asks for the key code of a private transfer. The code stays in this field and in the receiver's
 * memory; nothing is stored. A sender can also show a key QR, which the camera reads without typing.
 * @param props - Component properties.
 * @param props.onSubmit - Hands the typed key code to the receiver.
 * @param props.accepted - Whether the last code was readable.
 * @returns The key entry form.
 */
export function KeyCodeEntry({ onSubmit, accepted }: KeyCodeEntryProps) {
  const [code, setCode] = useState('');
  const statusId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) onSubmit(code);
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-4 text-xs" data-testid="key-code-entry">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <KeyRound className="size-4 text-accent" aria-hidden="true" />
        This transfer is private
      </p>
      <p className="text-fg-muted">Enter the eight-word key code the sender shows, or hold the key QR from the sender in front of the camera.</p>
      <TextField
        label="Key code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="word-word-word-word-word-word-word-word"
        aria-describedby={statusId}
      />
      <Button type="submit" variant="primary" disabled={code.trim().length === 0}>
        Unlock
      </Button>
      <p id={statusId} role="status" className="text-fg-muted" data-testid="key-code-status">
        {accepted === true && 'Key code accepted. Keep scanning.'}
        {accepted === false && 'That is not a key code. It has eight words from the sender.'}
      </p>
    </form>
  );
}
