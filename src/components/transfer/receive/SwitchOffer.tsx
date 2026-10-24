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
import { Button } from '@/components/ui/Button';
import { analyseReceivedFile } from '@/packages/core/files';
import type { PrismManifestInfo } from '@/packages/optical-transfer';

/** What the other stream holds, as far as its manifest tells. */
function describeOffer(offer: PrismManifestInfo): string {
  if (offer.encrypted) return 'A private transfer';
  if (offer.bundle) return offer.entryCount > 0 ? `${offer.entryCount} files` : 'Several files';
  const file = offer.files[0];
  return file ? analyseReceivedFile(file.name, file.mimeType).safeName : 'Another file';
}

/**
 * Offers to switch to another transfer that came into view, dropping what was received so far.
 * @returns The offer.
 */
export function SwitchOffer({ offer, onAnswer }: { offer: PrismManifestInfo; onAnswer: (accept: boolean) => void }) {
  return (
    <div data-testid="switch-offer" role="alert">
      <Alert variant="warning" title="Another transfer is in view">
        <p>
          {describeOffer(offer)}{' '}
          ({offer.fingerprint}) is also on screen. Switching drops what you have received so far.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => onAnswer(true)}>
            Switch to it
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAnswer(false)}>
            Keep this one
          </Button>
        </div>
      </Alert>
    </div>
  );
}
