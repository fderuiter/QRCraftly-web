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


/**
 * Optical Transfer Engine: what the app imports. The file-transfer pages reach the sender and
 * receiver through client.ts; this entry carries the shared contracts, labels and helpers they
 * show. Everything else has its own entry (#1602): protocol.ts (the Prism wire format, the
 * codecs and the transfer machinery: state machines, handshake gate, frame pool), and the
 * experimental layers, off by default: multicode.ts, feedback.ts and colour.ts.
 */

export { drawTransferFrame } from './lib/handshake';
export { TRANSFER_DENSITY_PROFILES, type TransferDensity } from './lib/fountain/session';
export type { FountainTelemetry } from './lib/fountain/reassembler';
export type { PrismManifestInfo } from './lib/prism/manifest';
export {
  createPrismSession,
  estimateTransferFrames,
  neededSymbols,
  type OuterCode,
} from './lib/prism/session';
export { formatDuration } from './lib/format';
export { describeCameraError } from './lib/camera';
export { steerMessage } from './lib/feedback/steerMessage';
export type { SenderPhase } from './lib/sender/machine';
export type { ReceiverPhase, ReceiverResult, ReceiverFailure } from './lib/receiver/machine';
