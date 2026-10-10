/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import type { QRConfig } from '@/types';
import type { LogoMetrics } from './utils';
import { drawLogoBackground } from './canvasHelpers';

export const renderLogo = (
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  displaySize: number,
  logoMetrics: LogoMetrics
) => {
  if (config.logoUrl && logoImg) {
    const { logoSizePx, logoPaddingPx } = logoMetrics;
    const lx = (displaySize - logoSizePx) / 2;
    const ly = (displaySize - logoSizePx) / 2;

    if (config.logoPaddingStyle !== 'none') {
      const bgColor = config.logoBackgroundColor || config.bgColor;
      drawLogoBackground(
        ctx,
        displaySize,
        logoSizePx,
        logoPaddingPx,
        config.logoPaddingStyle,
        bgColor
      );
    }

    ctx.drawImage(logoImg, lx, ly, logoSizePx, logoSizePx);
  }
};

