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

import { drawTransferFrame } from '@/packages/optical-transfer';
import type { TransferFrameRenderer } from '@/packages/optical-transfer/client';

/** CSS width, in pixels, of the transfer canvas. */
const DISPLAY_SIZE = 512;

/**
 * Paints one transfer frame onto the sender canvas in the fixed transfer look (#1307): black on
 * white, whatever the generator's appearance settings say. Injected into `useOpticalSender`.
 * @param canvas Target canvas.
 * @param frame Module matrix to paint.
 */
export const paintTransferFrame: TransferFrameRenderer = (canvas, frame) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = DISPLAY_SIZE * pixelRatio;
  canvas.height = DISPLAY_SIZE * pixelRatio;
  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);
  ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
  drawTransferFrame(ctx, frame, DISPLAY_SIZE);
  ctx.restore();
};
