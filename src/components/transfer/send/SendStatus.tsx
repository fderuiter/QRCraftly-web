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

import { PAUSED_ANNOUNCEMENT, PHOTOSENSITIVITY_NOTICE } from '@/utils/photosensitivity';

/**
 * A live region that is always present, so the photosensitivity notice is announced when it
 * appears and a pause is announced to screen readers.
 * @returns The status region.
 */
export function SendStatus({ showNotice, paused }: { showNotice: boolean; paused: boolean }) {
  return (
    <div role="status" aria-live="polite">
      {showNotice && (
        <p
          id="photosensitivity-notice"
          className="mb-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning"
          data-testid="photosensitivity-notice"
        >
          {PHOTOSENSITIVITY_NOTICE}
        </p>
      )}
      {paused && <p className="sr-only">{PAUSED_ANNOUNCEMENT}</p>}
    </div>
  );
}
