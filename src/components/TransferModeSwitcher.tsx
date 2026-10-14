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

import React from 'react';
import { Upload, Download } from 'lucide-react';

export interface TransferModeSwitcherProps {
  /** The current active workspace transfer mode. */
  currentMode: 'send' | 'receive';
}

/**
 * Route-aware segmented mode switcher control allowing instant role toggling
 * between "Send File" (/file-transfer) and "Receive File" (/file-transfer/receive).
 */
export function TransferModeSwitcher({ currentMode }: TransferModeSwitcherProps) {
  const isSend = currentMode === 'send';
  const isReceive = currentMode === 'receive';

  return (
    <nav
      aria-label="Transfer mode"
      className="inline-flex items-center rounded-xl border border-line bg-surface-hover p-1"
    >
      <a
        href="/file-transfer"
        aria-current={isSend ? 'page' : undefined}
        className={`inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm ${
          isSend
            ? 'bg-surface-raised text-accent-strong shadow-raised'
            : 'text-fg-muted hover:text-fg'
        }`}
      >
        <Upload className="size-4 shrink-0" aria-hidden="true" />
        <span>Send File</span>
      </a>
      <a
        href="/file-transfer/receive"
        aria-current={isReceive ? 'page' : undefined}
        className={`inline-flex min-h-11 min-w-28 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all sm:text-sm ${
          isReceive
            ? 'bg-surface-raised text-accent-strong shadow-raised'
            : 'text-fg-muted hover:text-fg'
        }`}
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        <span>Receive File</span>
      </a>
    </nav>
  );
}
