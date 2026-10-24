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

import { Alert } from '@/components/ui/Alert';

/** The sender stopped because every receiver in view had the file (#1146). */
export function AutoStoppedAlert() {
  return (
    <div className="mb-4">
      <Alert variant="info" title="Transfer stopped" role="status">
        Every receiver in view has the file, so the sender stopped.
      </Alert>
    </div>
  );
}

/**
 * The first frame failed its check, or the stream could not start.
 * @returns The error alert.
 */
export function HandshakeErrorAlert({ message }: { message: string }) {
  return (
    <div className="mb-4">
      <Alert variant="error" title="Transfer Paused" role="alert">
        {message}
      </Alert>
    </div>
  );
}
