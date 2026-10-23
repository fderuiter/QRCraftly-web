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

import { QRErrorCorrectionLevel, QRType, type QRConfig } from '@/types';

/** A call to action above the generator's controls: opens an appearance section and focuses one control in it. */
export interface LandingPrimaryAction {
  /** Button text, such as "Add your picture". */
  label: string;
  /** Title of the appearance section to open. */
  section: string;
  /** Id of the control to focus once the section is open. */
  focusId: string;
}

/** What a landing page asks of the generator it opens (#1035, #1037). */
export interface LandingPreset {
  /** QR type the generator starts on. */
  type: QRType;
  /** Settings that win over appearance kept from earlier routes. */
  presetConfig?: Partial<QRConfig>;
  /** Appearance sections that start expanded. */
  openSections?: readonly string[];
  /** Optional call to action that takes the person straight to the page's main input. */
  primaryAction?: LandingPrimaryAction;
  /** Page title shown in the generator header. */
  title: string;
}

/** High error correction and the Logo section open: the preset of both picture-in-code pages. */
const HIGH_EC_LOGO: Pick<LandingPreset, 'presetConfig' | 'openSections'> = {
  presetConfig: { errorCorrectionLevel: QRErrorCorrectionLevel.H },
  openSections: ['Logo'],
};

/**
 * The landing pages that open the generator with presets, by registry id. Each earns its page
 * with something the generic URL page lacks: a preset, instructions or examples (no doorway pages).
 */
export const LANDING_PRESETS: Readonly<Record<string, LandingPreset>> = {
  'mosaic-qr-code': {
    type: QRType.URL,
    title: 'Image QR Code',
    ...HIGH_EC_LOGO,
    primaryAction: { label: 'Add your picture', section: 'Logo', focusId: 'mosaic-upload-button' },
  },
  'qr-code-with-logo': { type: QRType.URL, title: 'QR Code with Logo', ...HIGH_EC_LOGO },
  'google-review-qr-code': { type: QRType.URL, title: 'Google Review QR Code' },
  'menu-qr-code': { type: QRType.URL, title: 'Menu QR Code' },
  'instagram-qr-code': { type: QRType.SOCIAL, title: 'Instagram QR Code' },
  'whatsapp-qr-code': { type: QRType.URL, title: 'WhatsApp QR Code', presetConfig: { value: 'https://wa.me/' } },
  'pdf-qr-code': { type: QRType.URL, title: 'PDF QR Code' },
  'static-qr-code-generator': { type: QRType.URL, title: 'Static QR Code' },
  'svg-qr-code': { type: QRType.URL, title: 'SVG QR Code' },
};

/** Registry ids of every landing page, with the checker last, in the order they are listed. */
export const LANDING_PAGE_IDS: readonly string[] = [...Object.keys(LANDING_PRESETS), 'qr-code-checker', 'qr-code-size-calculator'];

/** A static example picture in a landing page's gallery. */
export interface LandingGalleryImage {
  src: string;
  alt: string;
  caption: string;
}

/**
 * Example pictures built at deploy time (`scripts/generate_social_images.ts`), by registry id.
 * Both examples are the same working code for the QRCraftly address, made from a picture drawn in code.
 */
export const LANDING_GALLERIES: Readonly<Record<string, readonly LandingGalleryImage[]>> = {
  'mosaic-qr-code': [
    {
      src: '/examples/mosaic-halftone.png',
      alt: 'QR code tiled in halftone mode with fine detail inside each module',
      caption: 'Halftone: each module holds a 3x3 patch for detail.',
    },
    {
      src: '/examples/mosaic-tiles.png',
      alt: 'QR code tiled in tiles mode with one color per module',
      caption: 'Tiles: one color per module for bold scanning.',
    },
  ],
};
