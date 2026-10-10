import { getPublicDomain } from "./utils/metadataEngine";
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


import { QRStyle, QRType, QRErrorCorrectionLevel, SocialFormat, TemplateStyle } from './types';

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
  logoBackgroundColor: '#ffffff',
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
};

/**
 * List of available QR code pattern styles with display labels.
 * Used for the style selection UI.
 */
export const PATTERNS = [
  { id: QRStyle.STANDARD, label: 'Standard Industrial' },
  { id: QRStyle.MODERN, label: 'Modern Soft' },
  { id: QRStyle.SWISS, label: 'Swiss Dot' },
  { id: QRStyle.FLUID, label: 'Fluid Ink' },
  { id: QRStyle.CIRCUIT, label: 'Cyber Circuit' },
  { id: QRStyle.HIVE, label: 'The Hive' },
  { id: QRStyle.GRUNGE, label: 'Grunge' },
  { id: QRStyle.STARBURST, label: 'Starburst' },
];

export const LOW_RELIABILITY_PATTERNS: readonly QRStyle[] = [QRStyle.GRUNGE, QRStyle.CIRCUIT, QRStyle.STARBURST];

import colorsData from './colors.json' with { type: 'json' };

/**
 * List of preset color themes.
 * Each preset defines background, foreground, and eye colors.
 */
export const PRESET_COLORS = colorsData.presets;

/**
 * Centralized system limits to keep user interface, validation rules,
 * and documentation perfectly synchronized.
 */
export const SYSTEM_LIMITS = {
  MAX_LOGO_SIZE: 0.3,
  MAX_FILE_UPLOAD_MB: 2,
  SUPPORTED_IMAGE_FORMATS: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
};

/**
 * The minimum WCAG AA color contrast threshold for readability and accessibility.
 */
export const MIN_CONTRAST_THRESHOLD = 4.5;

export * from './constants/presetLogos';
