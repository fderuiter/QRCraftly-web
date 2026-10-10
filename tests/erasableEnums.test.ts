import { describe, expect, it } from 'vitest';
import {
  CalendarProvider,
  CryptoNetwork,
  QRErrorCorrectionLevel,
  QRStyle,
  QRType,
  SocialFormat,
  SocialPlatform,
  TemplateStyle,
  WifiEapMethod,
  WifiEapPhase2,
  WifiEncryption,
} from '../src/types';
import { SchemaCategory, SchemaType, StrategicValueCategory, TargetPersona } from '../src/data/contentRegistry';

// The former string enums, member by member, in declaration order, as they were before ADR 0045
// turned them into `as const` objects. Stored brand templates and URLs carry these values.
const EXPECTED = {
  QRStyle: [QRStyle, { STANDARD: 'standard', MODERN: 'modern', SWISS: 'swiss', FLUID: 'fluid', CIRCUIT: 'circuit', HIVE: 'hive', GRUNGE: 'grunge', STARBURST: 'starburst' }],
  QRType: [QRType, { URL: 'URL', TEXT: 'TEXT', WIFI: 'WIFI', EVENT: 'EVENT', EMAIL: 'EMAIL', VCARD: 'VCARD', PHONE: 'PHONE', SMS: 'SMS', PAYMENT: 'PAYMENT', LOCATION: 'LOCATION', MEETING: 'MEETING', SOCIAL: 'SOCIAL', BULK_CSV: 'BULK_CSV' }],
  WifiEncryption: [WifiEncryption, { WPA: 'WPA', WEP: 'WEP', NOPASS: 'nopass', WPA2_EAP: 'WPA2-EAP' }],
  WifiEapMethod: [WifiEapMethod, { PEAP: 'PEAP', TTLS: 'TTLS', TLS: 'TLS', PWD: 'PWD' }],
  WifiEapPhase2: [WifiEapPhase2, { NONE: '', MSCHAPV2: 'MSCHAPV2', GTC: 'GTC', PAP: 'PAP' }],
  QRErrorCorrectionLevel: [QRErrorCorrectionLevel, { L: 'L', M: 'M', Q: 'Q', H: 'H' }],
  CalendarProvider: [CalendarProvider, { ICAL: 'ical', GOOGLE: 'google', OUTLOOK: 'outlook', OFFICE365: 'office365', YAHOO: 'yahoo' }],
  CryptoNetwork: [CryptoNetwork, { BITCOIN: 'bitcoin', ETHEREUM: 'ethereum', SOLANA: 'solana', LITECOIN: 'litecoin', EPC_SEPA: 'epc_sepa', PAYPAL: 'paypal', VENMO: 'venmo', CASH_APP: 'cash_app', CUSTOM: 'custom' }],
  SocialPlatform: [SocialPlatform, { INSTAGRAM: 'instagram', TWITTER: 'twitter', TIKTOK: 'tiktok', LINKEDIN: 'linkedin', YOUTUBE: 'youtube', FACEBOOK: 'facebook', WHATSAPP: 'whatsapp', GITHUB: 'github' }],
  SocialFormat: [SocialFormat, { SQUARE_1_1: '1:1', PORTRAIT_4_5: '4:5', STORY_9_16: '9:16' }],
  TemplateStyle: [TemplateStyle, { NONE: 'none', MINIMALIST: 'minimalist', GRADIENT_BLUR: 'gradient_blur', SOLID_FRAME: 'solid_frame' }],
  SchemaType: [SchemaType, { SoftwareApplication: 'SoftwareApplication', WebApplication: 'WebApplication', AboutPage: 'AboutPage', FAQPage: 'FAQPage', HowTo: 'HowTo' }],
  SchemaCategory: [SchemaCategory, { UtilitiesApplication: 'UtilitiesApplication', BusinessApplication: 'BusinessApplication', SocialNetworkingApplication: 'SocialNetworkingApplication', TravelApplication: 'TravelApplication', DeveloperApplication: 'DeveloperApplication' }],
  TargetPersona: [TargetPersona, { HealthcareLegal: 'Healthcare & Legal', SecurityConsciousEnterprise: 'Security-Conscious Enterprise' }],
  StrategicValueCategory: [StrategicValueCategory, { ZeroTransitPrivacySovereignty: 'Zero-Transit Privacy Sovereignty', AsynchronousWebWorkerDiagnostics: 'Asynchronous Web Worker Diagnostics' }],
} as const;

describe('former enums as const objects (ADR 0045)', () => {
  it.each(Object.entries(EXPECTED))('%s keeps every member and value', (_name, [actual, expected]) => {
    expect(actual).toStrictEqual(expected);
  });

  it.each(Object.entries(EXPECTED))('%s iterates like the string enum did: values in declaration order, no reverse keys', (_name, [actual, expected]) => {
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    expect(Object.values(actual)).toEqual(Object.values(expected));
  });

  it('keeps the lists the app builds from them', () => {
    // The command palette and the template importer iterate these.
    expect(Object.values(QRErrorCorrectionLevel)).toEqual(['L', 'M', 'Q', 'H']);
    expect(Object.values(WifiEncryption)).toContain('WPA2-EAP');
    expect((Object.values(WifiEapPhase2) as string[]).includes('')).toBe(true);
    expect(Object.values(QRStyle)).toHaveLength(8);
  });
});
