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

import { describe, expect, it } from 'vitest';
import { QRType } from '@/packages/core/types';
import {
  CARD_FIELDS,
  CalendarProvider,
  CryptoNetwork,
  SocialPlatform,
  VCARD_SOCIAL_FIELDS,
  cardFieldsFor,
  constructSocialString,
  constructVCardString,
  constructWifiString,
  describeViolation,
  hasChronologicalViolation,
  paymentRefusal,
} from '@/packages/qr-payload';
import { buildPageContent, getPageSchema } from './pageContent';
import { contentRegistry, getMetadataForPath } from './contentRegistry';
import { guides } from './guides';
import { landingPageContent } from './landingPageContent';
import { LANDING_PAGE_IDS, LANDING_PRESETS } from './landingPages';
import { TYPE_PAGE_TYPES } from './relatedPages';
import { getGuideFaqs, guideFaqAnswer } from './guideFaqs';
import { typeGuides, type TypeGuide } from './typeGuides';
import { generateGuideSchema, generateSchema } from '../utils/schemaGenerator';
import { resolveDomainForPath } from '../utils/metadataEngine';
import { pageCopy } from '../../tests/utils/pageCopy';

const pathOf = (id: string) => (id === 'index' ? '/' : `/${id}`);

/** The FAQ entries a page's guide adds to its structured data, in page order. */
const guideFaqs = (id: string) =>
  typeGuides[id] ? getGuideFaqs(typeGuides[id]).map((faq) => ({ question: faq.question, answer: guideFaqAnswer(faq) })) : [];

describe('getPageSchema (#1058)', () => {
  const ownCopyIds = [...Object.keys(TYPE_PAGE_TYPES), 'qr-code-scanner', 'about', 'arcade', 'file-transfer', 'free-forever', 'security'];

  it.each(ownCopyIds)('builds the same schema %s rendered in the browser before', (id) => {
    const path = pathOf(id);
    const copy = pageCopy(id);
    const faqs = [...(copy.faqs ?? []), ...guideFaqs(id)];
    expect(getPageSchema(path)).toEqual(generateSchema({ ...contentRegistry[id], ...copy, faqs: faqs.length > 0 ? faqs : copy.faqs }, resolveDomainForPath(path), path));
  });

  it.each([...LANDING_PAGE_IDS])('builds the landing schema of %s from its how-to and FAQs', (id) => {
    const path = pathOf(id);
    const { howTo, faqs } = landingPageContent[id];
    expect(getPageSchema(path)).toEqual(generateSchema({ ...contentRegistry[id], howTo, faqs: [...faqs, ...guideFaqs(id)] }, resolveDomainForPath(path), path));
  });

  it.each(guides.map((guide) => guide.slug))('builds the article schema of the %s guide', (slug) => {
    const path = `/guides/${slug}`;
    const guide = guides.find((entry) => entry.slug === slug)!;
    expect(getPageSchema(path)).toEqual(generateGuideSchema(guide, resolveDomainForPath(path)));
  });

  it('builds the guide index schema', () => {
    expect(JSON.stringify(getPageSchema('/guides'))).toContain('CollectionPage');
  });

  it.each(['/privacy', '/support', '/acknowledgements', '/file-transfer/receive', '/no-such-page'])('has none for %s', (path) => {
    expect(getPageSchema(path)).toBeUndefined();
  });
});

describe('buildPageContent (#1058)', () => {
  it('gives a generator page its own entry, guide, example and related pages only', () => {
    const content = buildPageContent({ urlPathname: '/wifi-qr-code/' });
    expect(content.id).toBe('wifi-qr-code');
    expect(content.title).toBe(getMetadataForPath('/wifi-qr-code').title);
    expect(content.tool).toBe(contentRegistry['wifi-qr-code']);
    expect(content.guide).toBe(typeGuides['wifi-qr-code']);
    expect(content.example?.src).toBe('/examples/wifi-qr-code.svg');
    expect(content.related.map((page) => page.id)).not.toContain('wifi-qr-code');
    expect(content.landing).toBeUndefined();
    expect(content.gallery).toBeUndefined();
    // Only this page's text: other pages' copy stays out of its HTML.
    expect(JSON.stringify(content)).not.toContain(contentRegistry['vcard-qr-code'].description);
  });

  it('gives a landing page its copy and gallery', () => {
    const content = buildPageContent({ urlPathname: '/mosaic-qr-code' });
    expect(content.landing).toBe(landingPageContent['mosaic-qr-code']);
    expect(content.gallery?.length).toBeGreaterThan(0);
  });

  it.each(guides.map((guide) => guide.slug))('gives the %s guide page only its own article (#1597)', (slug) => {
    const content = buildPageContent({ urlPathname: `/guides/${slug}/` });
    const guide = guides.find((entry) => entry.slug === slug)!;
    expect(content.article?.guide).toBe(guide);
    expect(content.article?.related.map((other) => other.slug)).toEqual(guide.related);
    expect(content.guideIndex).toBeUndefined();
    // Other guides contribute their titles to the related links, never their bodies.
    const text = JSON.stringify(content);
    for (const other of guides) if (other.slug !== slug) expect(text).not.toContain(other.lead);
  });

  it('gives the guide hub summaries without the article bodies (#1597)', () => {
    const content = buildPageContent({ urlPathname: '/guides' });
    expect(content.guideIndex?.map((entry) => entry.slug)).toEqual(guides.map((guide) => guide.slug));
    expect(content.article).toBeUndefined();
    const text = JSON.stringify(content);
    for (const guide of guides) expect(text).not.toContain(guide.lead);
  });

  it('titles the 404 page from the error entry', () => {
    expect(buildPageContent({ urlPathname: '/missing', is404: true }).title).toBe(getMetadataForPath('/_error').title);
  });
});

/** Flattens a generator route's walkthrough and FAQ text for parity assertions. */
const copyTextOf = (id: string): string => {
  const copy = landingPageContent[id] ?? pageCopy(id);
  const steps = (copy.howTo?.steps ?? []).map((step) => `${step.name} ${step.text}`).join(' ');
  const faqs = (copy.faqs ?? []).map((faq) => `${faq.question} ${faq.answer}`).join(' ');
  return `${copy.howTo?.name ?? ''} ${copy.howTo?.description ?? ''} ${steps} ${faqs}`;
};

/** Flattens a TypeGuide's sections into one searchable text block. */
const guideTextOf = (guide: TypeGuide): string =>
  [guide.intro, ...guide.scanned, ...guide.useCases, ...guide.printing, ...guide.checks, guide.privacy].join(' ');

describe('generator copy parity with shipped inputs and payload validators', () => {
  it('covers Use Current Location, Google Maps links, geo: URIs, DMS, and accurate local geolocation privacy on location-qr-code', () => {
    const copyText = copyTextOf('location-qr-code');
    const guide = typeGuides['location-qr-code'];
    const guideText = guideTextOf(guide);

    for (const term of ['Google Maps Link or Coordinates', 'Google Maps', 'geo:', 'DMS', 'Use Current Location']) {
      expect(copyText, `location copy missing ${term}`).toContain(term);
    }
    for (const term of ['Google Maps', 'geo:', 'DMS', 'Use Current Location']) {
      expect(guideText, `location guide missing ${term}`).toContain(term);
    }

    expect(guide.privacy).toMatch(/Use Current Location/);
    expect(guide.privacy).toMatch(/permission/i);
    expect(guide.privacy).toMatch(/local/i);
    expect(guide.privacy).not.toMatch(/never asks for your device[’']s location/i);
  });

  it('lists every supported payment network including UPI (India) and mandatory SEPA Beneficiary Name and UPI Payee Name', () => {
    const copyText = copyTextOf('payment-qr-code');
    const guideText = guideTextOf(typeGuides['payment-qr-code']);

    const networkLabels: Record<CryptoNetwork, string> = {
      [CryptoNetwork.BITCOIN]: 'Bitcoin',
      [CryptoNetwork.ETHEREUM]: 'Ethereum',
      [CryptoNetwork.SOLANA]: 'Solana',
      [CryptoNetwork.LITECOIN]: 'Litecoin',
      [CryptoNetwork.EPC_SEPA]: 'SEPA Credit Transfer (EPC QR)',
      [CryptoNetwork.UPI]: 'UPI (India)',
      [CryptoNetwork.PAYPAL]: 'PayPal',
      [CryptoNetwork.VENMO]: 'Venmo',
      [CryptoNetwork.CASH_APP]: 'Cash App',
      [CryptoNetwork.CUSTOM]: 'Custom / Raw Address',
    };
    for (const network of Object.values(CryptoNetwork)) {
      expect(copyText, `payment copy missing ${network}`).toContain(networkLabels[network]);
    }

    // Cross-check against live paymentRefusal & describeViolation rules in qr-payload.
    const sepaViolation = paymentRefusal({
      network: CryptoNetwork.EPC_SEPA,
      address: 'DE89370400440532013000',
      amount: '',
      label: '',
    });
    expect(sepaViolation).toBe('SEPA_NAME_VIOLATION');
    expect(describeViolation(sepaViolation ?? '')).toContain('beneficiary');

    const upiViolation = paymentRefusal({
      network: CryptoNetwork.UPI,
      address: 'merchant@upi',
      amount: '',
      label: '',
    });
    expect(upiViolation).toBe('UPI_NAME_VIOLATION');
    expect(describeViolation(upiViolation ?? '')).toContain('payee');

    for (const requiredField of ['Beneficiary Name', 'Payee Name']) {
      expect(copyText, `payment copy missing ${requiredField}`).toContain(requiredField);
      expect(guideText, `payment guide missing ${requiredField}`).toContain(requiredField);
    }
  });

  it('documents All-day event, Repeat clearing, chronology validation, and web calendar provider sharing on event-qr-code', () => {
    const copyText = copyTextOf('event-qr-code');
    const guide = typeGuides['event-qr-code'];
    const guideText = guideTextOf(guide);

    const providerLabels: Record<CalendarProvider, string> = {
      [CalendarProvider.ICAL]: 'iCalendar (.ics)',
      [CalendarProvider.GOOGLE]: 'Google Calendar',
      [CalendarProvider.OUTLOOK]: 'Outlook Web',
      [CalendarProvider.OFFICE365]: 'Office 365',
      [CalendarProvider.YAHOO]: 'Yahoo Calendar',
    };
    for (const provider of Object.values(CalendarProvider)) {
      expect(copyText, `event copy missing ${provider}`).toContain(providerLabels[provider]);
      expect(guideText, `event guide missing ${provider}`).toContain(providerLabels[provider]);
    }

    expect(hasChronologicalViolation('2026-06-10T14:00', '2026-06-10T13:00')).toBe(true);
    for (const term of ['All-day event', 'Repeat', 'Occurrence Count']) {
      expect(copyText, `event copy missing ${term}`).toContain(term);
      expect(guideText, `event guide missing ${term}`).toContain(term);
    }
    expect(copyText).toMatch(/clears repeat settings/i);
    expect(copyText).toMatch(/chronological|cannot be earlier than the start/i);

    expect(guide.privacy).toContain('iCalendar (.ics)');
    for (const vendor of ['Google', 'Microsoft', 'Yahoo']) {
      expect(guide.privacy, `event privacy missing ${vendor}`).toContain(vendor);
    }
  });

  it('documents .csv, .txt, and .xlsx uploads plus legacy .xls rejection on bulk-csv-qr-code', () => {
    const copyText = copyTextOf('bulk-csv-qr-code');
    const guideText = guideTextOf(typeGuides['bulk-csv-qr-code']);
    const registryEntry = contentRegistry['bulk-csv-qr-code'];
    const registryText = `${registryEntry.description} ${(registryEntry.features ?? []).join(' ')}`;

    for (const ext of ['.csv', '.txt', '.xlsx', '.xls']) {
      expect(copyText, `bulk-csv copy missing ${ext}`).toContain(ext);
      expect(guideText, `bulk-csv guide missing ${ext}`).toContain(ext);
    }
    expect(registryText).toMatch(/CSV/i);
    expect(registryText).toMatch(/TXT/i);
    expect(registryText).toContain('.xlsx');
  });

  it('documents .vcf local import and MECard field omissions on vcard-qr-code', () => {
    const copyText = copyTextOf('vcard-qr-code');
    const guideText = guideTextOf(typeGuides['vcard-qr-code']);

    // Verify MECard omissions directly against cardFieldsFor('mecard') and constructVCardString.
    const mecardFields = new Set<string>(cardFieldsFor('mecard'));
    const omittedFromMecard = CARD_FIELDS.filter((field) => !mecardFields.has(field));
    expect(omittedFromMecard).toEqual(expect.arrayContaining(['photo', ...VCARD_SOCIAL_FIELDS]));

    const mecardEncoded = constructVCardString({
      version: 'mecard',
      firstName: 'Ada',
      lastName: 'Lovelace',
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      photo: 'https://example.com/ada.jpg',
      street: '12 Main St',
      city: 'Austin',
      state: 'Texas',
      zip: '78701',
      country: 'USA',
      github: 'ada',
    });
    expect(mecardEncoded).not.toContain('Texas');
    expect(mecardEncoded).not.toContain('ada.jpg');

    for (const term of ['.vcf', 'Choose a .vcf file', 'MECard', 'Profile Photo URL', 'Social Profiles', 'State or Province']) {
      expect(copyText, `vcard copy missing ${term}`).toContain(term);
    }
    for (const term of ['.vcf', 'Choose a .vcf file', 'MECard', 'Profile Photo URL', 'Social Profiles', 'State or Province']) {
      expect(guideText, `vcard guide missing ${term}`).toContain(term);
    }
  });

  it('lists WPA3 only (SAE) and warns about iPhone camera support on wifi-qr-code', () => {
    const copyText = copyTextOf('wifi-qr-code');
    const guideText = guideTextOf(typeGuides['wifi-qr-code']);

    expect(
      constructWifiString({ ssid: 'OfficeNet', password: 'secretpassword', encryption: 'SAE', hidden: false }),
    ).toContain('T:SAE;');
    for (const term of ['WPA / WPA2 / WPA3', 'WPA3 only (SAE)', 'iPhone']) {
      expect(copyText, `wifi copy missing ${term}`).toContain(term);
      expect(guideText, `wifi guide missing ${term}`).toContain(term);
    }
    expect(copyText).toMatch(/iPhone cameras may not/);
    expect(guideText).toMatch(/iPhone cameras may not/);
  });

  it('presets whatsapp-qr-code to SocialPlatform.WHATSAPP and documents automatic message encoding with zero %20 instructions', () => {
    expect(LANDING_PRESETS['whatsapp-qr-code']).toEqual({
      type: QRType.SOCIAL,
      socialPlatform: SocialPlatform.WHATSAPP,
      title: 'WhatsApp QR Code',
    });
    expect(
      constructSocialString({
        platform: SocialPlatform.WHATSAPP,
        handle: '15551234567',
        message: 'Hello world',
      }),
    ).toBe('https://wa.me/15551234567?text=Hello%20world');

    const whatsappCopy = copyTextOf('whatsapp-qr-code');
    const whatsappGuide = guideTextOf(typeGuides['whatsapp-qr-code']);
    const whatsappMeta = `${contentRegistry['whatsapp-qr-code'].description} ${(contentRegistry['whatsapp-qr-code'].features ?? []).join(' ')}`;

    for (const term of ['Phone Number', 'Pre-filled Message', 'digits only']) {
      expect(whatsappCopy, `whatsapp copy missing ${term}`).toContain(term);
    }
    expect(whatsappGuide).toContain('Pre-filled Message');
    expect(whatsappMeta).toContain('Phone Number');
    for (const block of [whatsappCopy, whatsappGuide, whatsappMeta]) {
      expect(block).not.toContain('%20');
      expect(block).not.toContain('?text=');
    }

    const socialCopy = copyTextOf('social-qr-code');
    const socialGuide = guideTextOf(typeGuides['social-qr-code']);
    const platformLabels: Record<SocialPlatform, string> = {
      [SocialPlatform.INSTAGRAM]: 'Instagram',
      [SocialPlatform.TWITTER]: 'X',
      [SocialPlatform.TIKTOK]: 'TikTok',
      [SocialPlatform.LINKEDIN]: 'LinkedIn',
      [SocialPlatform.YOUTUBE]: 'YouTube',
      [SocialPlatform.FACEBOOK]: 'Facebook',
      [SocialPlatform.WHATSAPP]: 'WhatsApp',
      [SocialPlatform.GITHUB]: 'GitHub',
    };
    for (const platform of Object.values(SocialPlatform)) {
      expect(socialCopy, `social copy missing ${platform}`).toContain(platformLabels[platform]);
      expect(socialGuide, `social guide missing ${platform}`).toContain(platformLabels[platform]);
    }
    for (const term of ['Phone Number', 'Pre-filled Message', 'digits only']) {
      expect(socialCopy, `social copy missing ${term}`).toContain(term);
      expect(socialGuide, `social guide missing ${term}`).toContain(term);
    }
    expect(socialCopy).not.toContain('%20');
    expect(socialGuide).not.toContain('%20');
  });
});
