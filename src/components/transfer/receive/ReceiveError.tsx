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

import { Upload } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { ReceiverFailure } from '@/packages/optical-transfer';

/** The alert's test id and title for each part that can fail. */
const BY_SOURCE: Record<ReceiverFailure['source'], { testId: string; title: string }> = {
  receiver: { testId: 'receiver-error', title: 'Transfer Error' },
  file: { testId: 'file-validation-error', title: 'Invalid File' },
  camera: { testId: 'camera-error', title: 'Camera unavailable' },
};

/**
 * Why the receive failed. A camera failure also offers the video file instead.
 * @param props.failure - Which part failed, and why.
 * @param props.onUseVideo - Switches to the video file, for a camera failure.
 * @returns The alert.
 */
export function ReceiveError({ failure, onUseVideo }: { failure: ReceiverFailure; onUseVideo?: () => void }) {
  const { testId, title } = BY_SOURCE[failure.source];
  return (
    <div data-testid={testId}>
      <Alert variant="error" title={title}>
        {failure.source === 'camera' ? (
          <>
            <p>{failure.message}</p>
            <p className="mt-2">
              No camera? Record the sender&apos;s screen with another device and open the recording under Video File.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onUseVideo}
            >
              <Upload className="size-4" aria-hidden="true" />
              Use a video file instead
            </Button>
          </>
        ) : (
          failure.message
        )}
      </Alert>
    </div>
  );
}
