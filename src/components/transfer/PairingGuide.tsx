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

import { Smartphone } from 'lucide-react';

/**
 * The pairing moment before a transfer starts: a phone drawn inside a pulsing frame, and what to
 * do on the other phone. The pulse runs only when motion is allowed.
 * @returns The pairing guide.
 */
export function PairingGuide() {
  return (
    <div className="mb-4 flex items-center gap-4 rounded-xl border border-line-subtle bg-surface-sunken p-4" data-testid="pairing-guide">
      <span className="relative flex size-16 shrink-0 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-2xl border-2 border-dashed border-accent motion-safe:animate-pulse" />
        <Smartphone className="size-8 text-accent" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">Point your other phone here</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          On the other phone open <a href="/file-transfer/receive" className="font-medium text-accent underline-offset-2 hover:underline">Receive</a>, press Start camera, then press Start Transfer here.
        </p>
      </div>
    </div>
  );
}
