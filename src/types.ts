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
 * Defines the visual style of the QR code.
 * Each style dictates the data modules, eye frame, and eyeball appearance.
 */
export enum QRStyle {
  STANDARD = 'standard',
  MODERN = 'modern',
  SWISS = 'swiss',
  FLUID = 'fluid',
  CIRCUIT = 'circuit',
  HIVE = 'hive',
  GRUNGE = 'grunge',
  STARBURST = 'starburst',
}

/**
 * Defines the type of data encoded in the QR code.
 */
export enum QRType {
  URL = 'URL',
  TEXT = 'TEXT',
  WIFI = 'WIFI',
  EVENT = 'EVENT',
  EMAIL = 'EMAIL',
  VCARD = 'VCARD',
  PHONE = 'PHONE',
  SMS = 'SMS',
  PAYMENT = 'PAYMENT',
  LOCATION = 'LOCATION',
  MEETING = 'MEETING',
  SOCIAL = 'SOCIAL',
  BULK_CSV = 'BULK_CSV',
}

/**
 * The standard contract for QR payload generators and hydrators.
 */
export interface QRGeneratorContract<TData> {
  /** The specific QR type this contract handles. */
  type: QRType;
  /** Constructs a string representation from the given data. */
  construct(data: TData): string;
  /** Parses a string to extract the payload data. */
  hydrate(raw: string): TData;
  /** Checks if the raw string matches this QR type. */
  matches(raw: string): boolean;
  /** Validates the constructed value, returning an array of violation strings. */
  validate?(raw: string): string[];
}

/**
 * Defines the encryption type for WiFi networks.
 */
export enum WifiEncryption {
  WPA = 'WPA',
  WEP = 'WEP',
  NOPASS = 'nopass',
  WPA2_EAP = 'WPA2-EAP',
}

/**
 * EAP methods for WPA2-Enterprise networks, emitted as the `E:` field of a WIFI payload.
 */
export enum WifiEapMethod {
  PEAP = 'PEAP',
  TTLS = 'TTLS',
  TLS = 'TLS',
  PWD = 'PWD',
}

/**
 * Phase 2 (inner) authentication for PEAP/TTLS, emitted as the `PH2:` field of a WIFI payload.
 * `NONE` omits the field.
 */
export enum WifiEapPhase2 {
  NONE = '',
  MSCHAPV2 = 'MSCHAPV2',
  GTC = 'GTC',
  PAP = 'PAP',
}

/**
 * Defines the shape of the padding area around an embedded logo.
 */
export type LogoPaddingStyle = 'square' | 'circle' | 'none';

/**
 * Defines the error correction level for the QR code.
 */
export enum QRErrorCorrectionLevel {
  L = 'L',
  M = 'M',
  Q = 'Q',
  H = 'H',
}

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
}

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
 * Data structure for an Email message.
 */
export interface EmailData {
  /** The recipient's email address. */
  email: string;
  /** The subject line of the email. */
  subject: string;
  /** The body content of the email. */
  body: string;
}

/**
 * Data structure for a vCard (electronic business card).
 */
export interface VCardData {
  /** The first name of the contact. */
  firstName: string;
  /** The last name of the contact. */
  lastName: string;
  /** The organization or company name. */
  organization: string;
  /** The job title of the contact. */
  title: string;
  /** The phone number of the contact. */
  phone: string;
  /** The email address of the contact. */
  email: string;
  /** The website URL of the contact. */
  website: string;
  /** The street address of the contact. */
  street: string;
  /** The city of the contact. */
  city: string;
  /** The postal or zip code of the contact. */
  zip: string;
  /** The country of the contact. */
  country: string;
  /** Optional profile photo encoded as a Base64 string or URL. */
  photo?: string;
}

/**
 * Data structure for a phone number.
 */
export interface PhoneData {
  /** The phone number to dial. */
  number: string;
}

/**
 * Data structure for an SMS message.
 */
export interface SmsData {
  /** The recipient's phone number. */
  number: string;
  /** The text message body. */
  message: string;
}

/**
 * Supported web calendar providers.
 */
export enum CalendarProvider {
  ICAL = 'ical',
  GOOGLE = 'google',
  OUTLOOK = 'outlook',
  OFFICE365 = 'office365',
  YAHOO = 'yahoo',
}

/**
 * Data structure for calendar event information.
 */
export interface EventData {
  /** The event title. */
  title: string;
  /** The event start date and time (ISO string from datetime-local input). */
  startDate: string;
  /** The event end date and time (ISO string from datetime-local input). */
  endDate: string;
  /** The event location. */
  location: string;
  /** The event description. */
  description: string;
  /** Target web calendar provider or standard iCal. */
  provider?: CalendarProvider | string;
}

/**
 * Supported cryptocurrency networks for payment.
 */
export enum CryptoNetwork {
  BITCOIN = 'bitcoin',
  ETHEREUM = 'ethereum',
  SOLANA = 'solana',
  LITECOIN = 'litecoin',
  CUSTOM = 'custom',
}

/**
 * Data structure for Payment information (Crypto).
 */
export interface PaymentData {
  /** The cryptocurrency network (e.g. bitcoin, ethereum). */
  network: CryptoNetwork;
  /** The wallet address. */
  address: string;
  /** The amount to request (optional). */
  amount: string;
  /** Label or message for the transaction (optional). */
  label: string;
}

/**
 * Data structure for URL information.
 */
export interface UrlData {
  /** The URL to encode. */
  url: string;
}

/**
 * Data structure for plain text information.
 */
export interface TextData {
  /** The text content to encode. */
  text: string;
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
 * Data structure for Geo-Location information.
 */
export interface LocationData {
  /** The latitude coordinate (decimal degrees, -90 to 90). */
  latitude: string;
  /** The longitude coordinate (decimal degrees, -180 to 180). */
  longitude: string;
}

/**
 * Supported social media platforms for deep links.
 */
export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  TWITTER = 'twitter',
  TIKTOK = 'tiktok',
}

/**
 * Data structure for Social Media deep links.
 */
export interface SocialData {
  /** The social media platform. */
  platform: SocialPlatform;
  /** The username or handle on the platform. */
  handle: string;
}

/**
 * Data structure for Virtual Meeting links (Zoom, Teams, Google Meet).
 */
export interface MeetingData {
  /** The full meeting invite URL. */
  url: string;
}

/**
 * Defines the social media export aspect ratio / format.
 */
export enum SocialFormat {
  SQUARE_1_1 = '1:1',
  PORTRAIT_4_5 = '4:5',
  STORY_9_16 = '9:16',
}

/**
 * Defines the visual template style applied to the social export canvas.
 */
export enum TemplateStyle {
  NONE = 'none',
  MINIMALIST = 'minimalist',
  GRADIENT_BLUR = 'gradient_blur',
  SOLID_FRAME = 'solid_frame',
}

/**
 * Data structure for Bulk CSV Batch QR generation.
 */
export interface BulkCsvData {
  /** Raw CSV string content. */
  csvContent: string;
  /** Selected column for the QR code payload. */
  payloadColumn: string;
  /** Selected column for the image filename. */
  filenameColumn: string;
  /** Output file format ('png' or 'svg'). */
  exportFormat: 'png' | 'svg';
  /** Original file name. */
  fileName?: string;
}

/**
 * Represents a brand design template containing visual styling properties.
 */
export interface BrandTemplate {
  /** Unique identifier for the template. */
  id: string;
  /** User-friendly name of the template. */
  name: string;
  /** Optional description or category label. */
  description?: string;
  /** ISO timestamp when template was created. */
  createdAt?: string;
  /** ISO timestamp when template was last updated. */
  updatedAt?: string;
  /** Indicates whether this is a system pre-built template preset. */
  isPrebuilt?: boolean;
  /** Partial QRConfig containing visual style fields only. */
  config: Partial<QRConfig>;
}

/**
 * The standard structure for brand template export/import JSON files.
 */
export interface BrandTemplateExportPayload {
  version: string;
  type: 'qrcraftly-brand-template';
  template: BrandTemplate;
}


