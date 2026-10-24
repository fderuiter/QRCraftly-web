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
 * Optical Transfer Engine — React entry point.
 * Thin hooks over the slice and reassembly workers. App capabilities (frame rendering, camera,
 * file saving) are injected by the caller; the package never imports the app layers.
 */

export { useOpticalSender } from './lib/sender/useOpticalSender';
// The sender's parts (#1511), composed by `useOpticalSender`. Exported so each can be tested on its own.
export { useSenderRefs, type SenderRefs } from './lib/sender/senderRefs';
export { useFrameLoop } from './lib/sender/useFrameLoop';
export { useSliceWorker, type SliceWorkerEvents } from './lib/sender/useSliceWorker';
export { useSteering, type SteeringOptions } from './lib/sender/useSteering';
export { useSenderSettings, planStream, PROFILE_FOR_DENSITY, type StreamPlan } from './lib/sender/useSenderSettings';
export {
  type UseOpticalSenderOptions,
  type SenderFountainInfo,
  type SenderTileInfo,
  type TransferFrame,
  type TransferFrameRenderer,
} from './lib/sender/senderTypes';

export {
  useOpticalReceiver,
  type UseOpticalReceiverOptions,
  type ReceivedFileSaver,
} from './lib/receiver/useOpticalReceiver';
export type { ReceivedBundleFile } from './lib/receiver/machine';
