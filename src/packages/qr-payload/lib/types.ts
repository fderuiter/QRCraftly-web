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

import type { QRType } from '@/packages/core/types';

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
 * Data structure for an Email message.
 */
export interface EmailData {
  /** The recipient's email address. */
  email: string;
  /** Carbon copy recipients (optional). */
  cc?: string;
  /** Blind carbon copy recipients (optional). */
  bcc?: string;
  /** The subject line of the email. */
  subject: string;
  /** The body content of the email. */
  body: string;
}

/**
 * Data structure for a vCard (electronic business card).
 */
export interface VCardData {
  /** The contact format standard version. Defaults to '3.0'. */
  version?: '2.1' | '3.0' | '4.0' | 'mecard';
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
  /** Profile photo image URL (vCard photo avatar). */
  photo?: string;
  /** X handle or profile link (vCard only). */
  x?: string;
  /** LinkedIn handle or profile link (vCard only). */
  linkedin?: string;
  /** Instagram handle or profile link (vCard only). */
  instagram?: string;
  /** Facebook handle or profile link (vCard only). */
  facebook?: string;
  /** GitHub handle or profile link (vCard only). */
  github?: string;
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
export const CalendarProvider = {
  ICAL: 'ical',
  GOOGLE: 'google',
  OUTLOOK: 'outlook',
  OFFICE365: 'office365',
  YAHOO: 'yahoo',
} as const;
export type CalendarProvider = (typeof CalendarProvider)[keyof typeof CalendarProvider];

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
  /** Optional IANA timezone identifier (e.g. 'America/New_York', 'UTC') or local. */
  timezone?: string;
  /** An all-day event: the dates are `YYYY-MM-DD` and the end date is the last day, inclusive. */
  allDay?: boolean;
  /** Recurrence frequency for repeating events. */
  recurrenceFreq?: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  /** Optional count of occurrences for event recurrence. */
  recurrenceCount?: number;
  /** The event location. */
  location: string;
  /** The event description. */
  description: string;
  /** Target web calendar provider or standard iCal. */
  provider?: CalendarProvider | string;
}

/**
 * Supported payment networks (Crypto & Fiat).
 */
export const CryptoNetwork = {
  BITCOIN: 'bitcoin',
  ETHEREUM: 'ethereum',
  SOLANA: 'solana',
  LITECOIN: 'litecoin',
  EPC_SEPA: 'epc_sepa',
  UPI: 'upi',
  PAYPAL: 'paypal',
  VENMO: 'venmo',
  CASH_APP: 'cash_app',
  CUSTOM: 'custom',
} as const;
export type CryptoNetwork = (typeof CryptoNetwork)[keyof typeof CryptoNetwork];

/**
 * Data structure for Payment information (Crypto & Fiat).
 */
export interface PaymentData {
  /** The payment network (e.g. bitcoin, epc_sepa, paypal). */
  network: CryptoNetwork;
  /** The wallet address, account ID, or handle. */
  address: string;
  /** The amount to request (optional). */
  amount: string;
  /** Label or message for the transaction (optional). */
  label: string;
  /** Beneficiary name for SEPA transfers (optional). */
  name?: string;
  /** IBAN for SEPA transfers (optional). */
  iban?: string;
  /** BIC / SWIFT code for SEPA transfers (optional). */
  bic?: string;
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
export const SocialPlatform = {
  INSTAGRAM: 'instagram',
  TWITTER: 'twitter',
  TIKTOK: 'tiktok',
  LINKEDIN: 'linkedin',
  YOUTUBE: 'youtube',
  FACEBOOK: 'facebook',
  WHATSAPP: 'whatsapp',
  GITHUB: 'github',
} as const;
export type SocialPlatform = (typeof SocialPlatform)[keyof typeof SocialPlatform];

/**
 * Data structure for Social Media deep links.
 */
export interface SocialData {
  /** The social media platform. */
  platform: SocialPlatform;
  /** The username or handle on the platform. */
  handle: string;
  /** Optional pre-filled message for WhatsApp links. */
  message?: string;
}

/**
 * Data structure for Virtual Meeting links (Zoom, Teams, Google Meet).
 */
export interface MeetingData {
  /** The full meeting invite URL. */
  url: string;
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
  /** Output file format ('png', 'svg', 'eps', or 'pdf'). */
  exportFormat: 'png' | 'svg' | 'eps' | 'pdf';
  /**
   * How payload cells are read: 'link' normalises each cell like the Link generator, 'text'
   * encodes it as typed. Defaults to 'link'.
   */
  contentType?: 'link' | 'text';
  /** PNG export resolution in pixels (e.g. 500, 1000, 2000, 3000). Defaults to 1000. */
  exportResolution?: number;
  /** Original file name. */
  fileName?: string;
}
