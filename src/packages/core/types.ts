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
 * QR types shared by two or more packages: the design (`QRConfig` and the option types it is
 * built from), the code types and the Wi-Fi payload (ADR 0052). Types used by one package or by
 * the app alone stay in `src/types.ts`.
 */

import type { EccLevel } from './ecc';

/**
 * Defines the visual style of the QR code.
 * Each style dictates the data modules, eye frame, and eyeball appearance.
 */
export const QRStyle = {
  STANDARD: 'standard',
  MODERN: 'modern',
  SWISS: 'swiss',
  FLUID: 'fluid',
  CIRCUIT: 'circuit',
  HIVE: 'hive',
  GRUNGE: 'grunge',
  STARBURST: 'starburst',
} as const;
export type QRStyle = (typeof QRStyle)[keyof typeof QRStyle];

/**
 * A shape for a finder eye's outer frame or inner ball, chosen apart from the module pattern.
 * A config without one draws the eye the way its pattern does.
 */
export const EyeShape = {
  SQUARE: 'square',
  ROUNDED: 'rounded',
  CIRCLE: 'circle',
  LEAF: 'leaf',
} as const;
export type EyeShape = (typeof EyeShape)[keyof typeof EyeShape];

/**
 * Defines the type of data encoded in the QR code.
 */
export const QRType = {
  URL: 'URL',
  TEXT: 'TEXT',
  WIFI: 'WIFI',
  EVENT: 'EVENT',
  EMAIL: 'EMAIL',
  VCARD: 'VCARD',
  PHONE: 'PHONE',
  SMS: 'SMS',
  PAYMENT: 'PAYMENT',
  LOCATION: 'LOCATION',
  MEETING: 'MEETING',
  SOCIAL: 'SOCIAL',
  BULK_CSV: 'BULK_CSV',
} as const;
export type QRType = (typeof QRType)[keyof typeof QRType];

/**
 * Defines the encryption type for WiFi networks.
 */
export const WifiEncryption = {
  WPA: 'WPA',
  WEP: 'WEP',
  NOPASS: 'nopass',
  WPA2_EAP: 'WPA2-EAP',
  SAE: 'SAE',
} as const;
export type WifiEncryption = (typeof WifiEncryption)[keyof typeof WifiEncryption];

/**
 * EAP methods for WPA2-Enterprise networks, emitted as the `E:` field of a WIFI payload.
 */
export const WifiEapMethod = {
  PEAP: 'PEAP',
  TTLS: 'TTLS',
  TLS: 'TLS',
  PWD: 'PWD',
} as const;
export type WifiEapMethod = (typeof WifiEapMethod)[keyof typeof WifiEapMethod];

/**
 * Phase 2 (inner) authentication for PEAP/TTLS, emitted as the `PH2:` field of a WIFI payload.
 * `NONE` omits the field.
 */
export const WifiEapPhase2 = {
  NONE: '',
  MSCHAPV2: 'MSCHAPV2',
  GTC: 'GTC',
  PAP: 'PAP',
} as const;
export type WifiEapPhase2 = (typeof WifiEapPhase2)[keyof typeof WifiEapPhase2];

/**
 * Defines the shape of the padding area around an embedded logo.
 */
export type LogoPaddingStyle = 'square' | 'circle' | 'none';

/**
 * Defines the type of gradient fill applied to QR code modules.
 */
export type GradientType = 'none' | 'linear' | 'radial';

/**
 * Defines a single color stop along a gradient.
 */
export interface ColorStop {
  /** Stop offset from 0.0 (start) to 1.0 (end). */
  offset: number;
  /** Color in CSS hex string format. */
  color: string;
}

/**
 * Defines the error correction level for the QR code.
 */
export const QRErrorCorrectionLevel = {
  L: 'L',
  M: 'M',
  Q: 'Q',
  H: 'H',
} as const;
export type QRErrorCorrectionLevel = EccLevel;

/**
 * Configuration interface for generating a QR code.
 * Contains all visual and data parameters.
 */
export interface QRConfig {
  /** The raw data string to be encoded (e.g., URL, text). */
  value: string;
  /** The type of content being encoded. */
  type: QRType;
  /** The foreground color of the QR code modules. */
  fgColor: string;
  /** The background color of the QR code. */
  bgColor: string;
  /** The visual style of the QR code modules. */
  style: QRStyle;
  /** The URL of the logo image to be embedded in the center, or null if none. */
  logoUrl: string | null;
  /** The size of the logo relative to the QR code size (usually 0.1 to 0.4). */
  logoSize: number;
  /** The shape of the background padding behind the logo. */
  logoPaddingStyle: LogoPaddingStyle;
  /** The size of the padding around the logo in modules. */
  logoPadding: number;
  /** The background color of the logo padding area. */
  logoBackgroundColor: string;
  /** The color of the position detection patterns (eyes) in the corners. */
  eyeColor: string;
  /** Optional independent color for the outer finder eye frames. Falls back to eyeColor. */
  eyeFrameColor?: string;
  /** Optional independent color for the inner eyeballs. Falls back to eyeColor. */
  eyeBallColor?: string;
  /** Optional shape for the outer eye frames. Without one, the frames follow `style`. */
  eyeFrameShape?: EyeShape;
  /** Optional shape for the inner eyeballs. Without one, the balls follow `style`. */
  eyeBallShape?: EyeShape;
  /** The error correction level. */
  errorCorrectionLevel: QRErrorCorrectionLevel;
  /** Whether to draw a border around the QR code. */
  isBorderEnabled: boolean;
  /** The size of the border relative to the QR code size (0.0 to 0.1). */
  borderSize: number;
  /** The color of the border. */
  borderColor: string;
  /** The visual style of the border. */
  borderStyle: BorderStyle;
  /** Text to display on the border. */
  borderText: string;
  /** Position of the border text. */
  borderTextPosition: BorderTextPosition;
  /** Color of the border text. */
  borderTextColor: string;
  /** Secondary logo to display on the border. */
  borderLogoUrl: string | null;
  /** Position of the border logo. */
  borderLogoPosition: BorderLogoPosition;
  /** The social media export aspect ratio format. */
  socialFormat: SocialFormat;
  /** The visual template style wrapping the QR code in the export. */
  templateStyle: TemplateStyle;
  /** Optional headline text rendered above the QR code in a template. */
  templateHeadline?: string;
  /** Optional subtext rendered below the QR code in a template. */
  templateSubtext?: string;
  /** Optional background color for the template canvas (overrides bgColor when set). */
  templateBgColor?: string;
  /** Optional text/accent color used in template backgrounds and text (overrides fgColor when set). */
  templateTextColor?: string;
  /**
   * Scale multiplier for the QR code bounding box within the template canvas.
   * 1.0 = default size (50 % of canvas width for non-NONE templates).
   * Valid range: 0.5 – 1.5.
   */
  templateQrScale?: number;
  /** Complete sequence of string values representing animated QR frames. */
  animationValues?: string[];
  /** Flag specifying if the visual animation loop is currently active. */
  isAnimating?: boolean;
  /** Desired playback speed of the animation loop in frames per second (FPS). Defaults to 30. */
  animationFps?: number;
  /** Whether to draw a solvable maze overlay. */
  isMazeEnabled?: boolean;
  /** Whether to enable scannability-audited bridge channels. */
  isMazeBridgesEnabled?: boolean;
  /** The color of the maze paths. */
  mazeColor?: string;
  /** Custom path width. */
  mazePathWidth?: number;
  /** Whether to show the solved maze path. */
  showMazeSolution?: boolean;
  /** Optional background photo image URL. */
  backgroundImageUrl?: string | null;
  /** Whether module-group batched luminance masking is enabled. */
  isLuminanceMaskingEnabled?: boolean;
  /** Custom dark module color for batched luminance masking. */
  fgColorDark?: string;
  /** Custom light module color for batched luminance masking. */
  fgColorLight?: string;
  /** Relative luminance threshold separating light and dark background cells (0..1). */
  luminanceThreshold?: number;
  /** Image tiled into the modules as a Mosaic QR (normally a `data:` URL), or null for none. */
  mosaicImageUrl?: string | null;
  /** Mosaic layout: one tile per module, or 3x3 halftone sub-cells with a full-contrast core. */
  mosaicMode?: MosaicMode;
  /** How hard mosaic tiles are pushed towards their dark or light value (0..1). */
  mosaicContrast?: number;
  /** The visual shape / style of the outer frame CTA badge. */
  frameStyle?: FrameStyle;
  /** Call-to-action text displayed inside the frame badge. */
  frameText?: string;
  /** Text and icon color for the frame badge. */
  frameTextColor?: string;
  /** Background color for the frame badge. */
  frameBgColor?: string;
  /** Position of the frame badge relative to the QR code. */
  framePosition?: FramePosition;
  /** Optional icon to display inside the frame badge. */
  frameIcon?: FrameIcon;
  /** Typography font family for the frame badge text. */
  frameFontFamily?: FrameFontFamily;
  /** Type of gradient fill applied to QR code modules ('none', 'linear', or 'radial'). */
  gradientType?: GradientType;
  /** Sequence of color stops defining the gradient fill. */
  gradientColorStops?: ColorStop[];
  /** Angle in degrees for linear gradient fill (0 to 360). */
  gradientAngle?: number;
  /** Quiet zone margin around the QR matrix in modules (2 to 10). Defaults to 4. */
  quietZoneModules?: number;
}

/**
 * Defines the visual shape / style of the outer frame CTA badge.
 */
export type FrameStyle = 'none' | 'pill' | 'banner' | 'speech-bubble' | 'card';

/**
 * Defines the position of the outer frame CTA badge relative to the QR code.
 */
export type FramePosition = 'bottom' | 'top' | 'left' | 'right';

/**
 * Defines the optional icon displayed inside the frame CTA badge.
 */
export type FrameIcon = 'none' | 'scan' | 'camera' | 'star' | 'heart' | 'info' | 'phone';

/**
 * Available typography font family choices for the outer frame CTA badge.
 */
export const FRAME_FONT_FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
  'display',
  'cursive',
] as const;

/**
 * Defines the typography font family for the outer frame CTA badge text.
 */
export type FrameFontFamily = (typeof FRAME_FONT_FAMILIES)[number];

/**
 * Mosaic QR layout (ADR 0019).
 */
export type MosaicMode = 'tiles' | 'halftone';

/**
 * Defines the style of the border around the QR code.
 */
export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double';

/**
 * Defines the position of the text on the border.
 */
export type BorderTextPosition = 'top-center' | 'bottom-center';

/**
 * Defines the position of the logo on the border.
 */
export type BorderLogoPosition = 'bottom-center' | 'bottom-right';

/**
 * Data structure for WiFi network configuration.
 */
export interface WifiData {
  /** The SSID (network name) of the WiFi network. */
  ssid: string;
  /** The password for the WiFi network. */
  password: string;
  /** The encryption type used by the network. */
  encryption: WifiEncryption;
  /** Whether the network SSID is hidden. */
  hidden: boolean;
  /** The identity for WPA2-EAP enterprise networks (optional). */
  eapIdentity?: string;
  /** The EAP method for WPA2-EAP networks (`E:` field). Defaults to PEAP. */
  eapMethod?: WifiEapMethod;
  /** The phase 2 authentication for WPA2-EAP networks (`PH2:` field). Defaults to MSCHAPV2. */
  eapPhase2?: WifiEapPhase2;
}

/**
 * Interface representing the modules of a QR code.
 */
export interface QRModules {
  /** The size of the QR code in modules. */
  size: number;
  /** Gets the module value at the specified row and column. */
  get(row: number, col: number): boolean;
}

/**
 * Defines the social media export aspect ratio / format.
 */
export const SocialFormat = {
  SQUARE_1_1: '1:1',
  PORTRAIT_4_5: '4:5',
  STORY_9_16: '9:16',
} as const;
export type SocialFormat = (typeof SocialFormat)[keyof typeof SocialFormat];

/**
 * Defines the visual template style applied to the social export canvas.
 */
export const TemplateStyle = {
  NONE: 'none',
  MINIMALIST: 'minimalist',
  GRADIENT_BLUR: 'gradient_blur',
  SOLID_FRAME: 'solid_frame',
  WIFI_CARD: 'wifi_card',
} as const;
export type TemplateStyle = (typeof TemplateStyle)[keyof typeof TemplateStyle];
