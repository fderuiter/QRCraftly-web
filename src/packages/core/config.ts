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

import { getPublicDomain } from './site';
import { type QRConfig, QRErrorCorrectionLevel, QRStyle, QRType, SocialFormat, TemplateStyle } from './types';

/**
 * Determines whether independent solid finder pattern eye colors are active.
 * Explicit `isCustomEyeColor` booleans take precedence; when `undefined` (such as
 * `DEFAULT_CONFIG`, `STYLE_BASELINE`, or legacy templates), custom eye colors are
 * inferred whenever the effective outer frame or inner ball color differs from `fgColor`.
 */
export function hasCustomEyeColor(
  config: Pick<QRConfig, 'isCustomEyeColor' | 'fgColor' | 'eyeColor' | 'eyeFrameColor' | 'eyeBallColor'>
): boolean {
  if (typeof config.isCustomEyeColor === 'boolean') {
    return config.isCustomEyeColor;
  }
  const fg = config.fgColor.trim().toLowerCase();
  const frame = (config.eyeFrameColor || config.eyeColor || config.fgColor).trim().toLowerCase();
  const ball = (config.eyeBallColor || config.eyeColor || config.fgColor).trim().toLowerCase();
  return frame !== fg || ball !== fg;
}

/**
 * The default configuration settings for the QR code generator.
 * Used to initialize the application state.
 */
export const DEFAULT_CONFIG = {
  value: getPublicDomain(),
  type: QRType.URL,
  fgColor: '#000000',
  bgColor: '#ffffff',
  style: QRStyle.STANDARD,
  logoUrl: null,
  logoSize: 0.2,
  logoPaddingStyle: 'square' as const,
  logoPadding: 1,
  logoBackgroundColor: '',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.H,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: '#000000',
  borderStyle: 'solid' as const,
  borderText: '',
  borderTextPosition: 'bottom-center' as const,
  borderTextColor: '#ffffff',
  borderLogoUrl: null,
  borderLogoPosition: 'bottom-center' as const,
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  templateHeadline: '',
  templateSubtext: '',
  templateQrScale: 1.0,
  isMazeEnabled: false,
  isMazeBridgesEnabled: true,
  mazeColor: '#3b82f6',
  showMazeSolution: false,
  frameStyle: 'none' as const,
  frameText: '',
  frameTextColor: '#ffffff',
  frameBgColor: '#000000',
  framePosition: 'bottom' as const,
  frameIcon: 'none' as const,
  frameFontFamily: 'sans-serif' as const,
  quietZoneModules: 4,
};
