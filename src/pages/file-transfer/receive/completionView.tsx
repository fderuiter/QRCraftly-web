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

import type { ReceiverPhase, ReceiverResult } from '@/packages/optical-transfer';
import { lazy, Suspense } from 'react';
import { triggerFileDownload } from '@/utils/downloadManager';

// The finished views load on demand: nobody sees them before a transfer completes.
const BcUrComplete = lazy(() => import('@/components/transfer/BcUrComplete').then((module) => ({ default: module.BcUrComplete })));
const BundleComplete = lazy(() => import('@/components/transfer/BundleComplete').then((module) => ({ default: module.BundleComplete })));
const TransferComplete = lazy(() => import('@/components/transfer/TransferComplete').then((module) => ({ default: module.TransferComplete })));

/** A finished wallet-style (BC-UR) stream. */
type WalletResult = Extract<ReceiverResult, { kind: 'bcur' }>['result'];

/** What the completion view needs from the page. */
export interface CompletionHandlers {
  saved: boolean;
  onSaveFile: () => void;
  onSaveAll: () => void;
  onReceiveAnother: () => void;
}

/**
 * The view for a finished receive, picked by phase and then by what was received; null while nothing is finished.
 * @param phase - Where the receive stands.
 * @param result - What a finished receive holds.
 * @param bcur - A finished wallet-style stream, which stays on screen until Clear.
 * @param handlers - Saving and starting over.
 */
export function completionView(phase: ReceiverPhase, result: ReceiverResult | null, bcur: WalletResult | null, handlers: CompletionHandlers) {
  const view = finishedView(phase, result, bcur, handlers);
  return view && <Suspense fallback={null}>{view}</Suspense>;
}

/**
 * Picks the finished view without its loading boundary.
 * @param phase - Where the receive stands.
 * @param result - What a finished receive holds.
 * @param bcur - A finished wallet-style stream.
 * @param handlers - Saving and starting over.
 * @returns The view, or null.
 */
function finishedView(phase: ReceiverPhase, result: ReceiverResult | null, bcur: WalletResult | null, handlers: CompletionHandlers) {
  if (bcur) return <BcUrComplete type={bcur.type} content={bcur.content} onSave={triggerFileDownload} onReceiveAnother={handlers.onReceiveAnother} />;
  switch (phase) {
    case 'complete':
      if (!result || result.kind === 'bcur') return null;
      if (result.kind === 'bundle') {
        return <BundleComplete files={result.files} onSaveFile={triggerFileDownload} onSaveAll={handlers.onSaveAll} onReceiveAnother={handlers.onReceiveAnother} />;
      }
      return (
        <TransferComplete
          fileName={result.handshake?.fileName ?? 'received-file'}
          fileSize={result.data.length}
          mimeType={result.handshake?.mimeType ?? ''}
          sha256={result.handshake?.sha256}
          verified
          data={result.data}
          saved={handlers.saved}
          onSave={handlers.onSaveFile}
          onReceiveAnother={handlers.onReceiveAnother}
        />
      );
    case 'idle':
    case 'awaitingVideo':
    case 'scanning':
    case 'needsKey':
    case 'receiving':
    case 'verifying':
    case 'failed':
      return null;
  }
}
