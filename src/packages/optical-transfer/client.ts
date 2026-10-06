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

export {
  useOpticalSender,
  type UseOpticalSenderOptions,
  type SenderFountainInfo,
  type SenderTileInfo,
  type TransferFrame,
  type TransferFrameRenderer,
} from './lib/sender/useOpticalSender';

export {
  useOpticalReceiver,
  type UseOpticalReceiverOptions,
  type ReceivedFileSaver,
  type ReceivedBundleFile,
} from './lib/receiver/useOpticalReceiver';
