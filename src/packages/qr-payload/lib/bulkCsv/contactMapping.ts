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

import type { CsvRow } from './csv';
import type { BulkContentType } from './cell';
import type { BulkContactMapping, VCardData } from '../types';
import { constructVCardString } from '../generators/vcard';
import { isDangerousUrl } from '@/packages/core/security';
import { CONTAINMENT_PROFILES } from '../protocol';

const REGEX_STRICT_CONTROL_NO_G = /[\x00-\x1F\x7F-\x9F]/;

export const CONTACT_FIRST_NAME_WORDS: readonly string[] = [
  'first_name',
  'firstname',
  'first name',
  'first',
  'given_name',
  'givenname',
  'given name',
  'fname',
  'name',
  'full_name',
  'fullname',
  'full name',
  'contact_name',
  'contact',
];

export const CONTACT_LAST_NAME_WORDS: readonly string[] = [
  'last_name',
  'lastname',
  'last name',
  'last',
  'surname',
  'family_name',
  'familyname',
  'family name',
  'lname',
];

export const CONTACT_PHONE_WORDS: readonly string[] = [
  'phone',
  'phone_number',
  'phonenumber',
  'phone number',
  'tel',
  'telephone',
  'mobile',
  'mobile_phone',
  'mobilephone',
  'mobile phone',
  'cell',
  'cellphone',
  'cellular',
  'work_phone',
  'workphone',
];

export const CONTACT_EMAIL_WORDS: readonly string[] = [
  'email',
  'e-mail',
  'mail',
  'email_address',
  'emailaddress',
  'email address',
  'e_mail',
  'e_mail_address',
];

export const CONTACT_ORG_WORDS: readonly string[] = [
  'organization',
  'organisation',
  'org',
  'company',
  'company_name',
  'companyname',
  'company name',
  'business',
  'business_name',
  'employer',
  'workplace',
  'institution',
];

export const CONTACT_TITLE_WORDS: readonly string[] = [
  'title',
  'job_title',
  'jobtitle',
  'job title',
  'role',
  'position',
  'designation',
  'occupation',
];

export const CONTACT_WEBSITE_WORDS: readonly string[] = [
  'website',
  'website_url',
  'websiteurl',
  'website url',
  'web',
  'url',
  'homepage',
  'home_page',
  'webpage',
  'web_page',
  'company_website',
  'company_url',
  'site',
  'link',
];

export const CONTACT_STREET_WORDS: readonly string[] = [
  'street',
  'street_address',
  'streetaddress',
  'street address',
  'address_line_1',
  'address_line1',
  'address1',
  'addr',
  'mailing_address',
  'office_address',
  'work_address',
  'postal_address',
  'address',
];

export const CONTACT_CITY_WORDS: readonly string[] = [
  'city',
  'town',
  'locality',
  'municipality',
  'suburb',
];

export const CONTACT_ZIP_WORDS: readonly string[] = [
  'postal_code',
  'postalcode',
  'postal code',
  'zip',
  'zip_code',
  'zipcode',
  'zip code',
  'postcode',
  'post_code',
  'post code',
  'postal',
];

export const CONTACT_COUNTRY_WORDS: readonly string[] = [
  'country',
  'country_name',
  'countryname',
  'country name',
  'nation',
];

/** Logical section grouping for contact mapping controls. */
export type BulkContactFieldGroup = 'core' | 'postal';

/** Declarative descriptor for a supported bulk vCard contact field. */
export interface BulkContactFieldDescriptor {
  /** Property key on `BulkContactMapping` and `VCardData`. */
  readonly key: keyof BulkContactMapping;
  /** Human-readable field label for controls, previews, and validation messages. */
  readonly label: string;
  /** Canonical CSV starter template column header. */
  readonly header: string;
  /** Mapping panel group ('core' shown directly, 'postal' grouped in collapsible section). */
  readonly group: BulkContactFieldGroup;
  /** Stable DOM id and test id for the mapping select control. */
  readonly controlId: string;
  /** Ranked lowercase header aliases for automatic column matching. */
  readonly aliases: readonly string[];
}

/**
 * Single declarative registry of all eleven supported bulk vCard contact fields.
 * Drives CSV starter template headers, automatic column detection, mapping UI controls,
 * row preview column roles, and RFC 6350 vCard synthesis and validation.
 */
export const BULK_CONTACT_FIELDS: readonly BulkContactFieldDescriptor[] = [
  {
    key: 'firstName',
    label: 'First Name',
    header: 'first_name',
    group: 'core',
    controlId: 'bulk-contact-firstname',
    aliases: CONTACT_FIRST_NAME_WORDS,
  },
  {
    key: 'lastName',
    label: 'Last Name',
    header: 'last_name',
    group: 'core',
    controlId: 'bulk-contact-lastname',
    aliases: CONTACT_LAST_NAME_WORDS,
  },
  {
    key: 'organization',
    label: 'Organization',
    header: 'organization',
    group: 'core',
    controlId: 'bulk-contact-organization',
    aliases: CONTACT_ORG_WORDS,
  },
  {
    key: 'title',
    label: 'Job Title',
    header: 'job_title',
    group: 'core',
    controlId: 'bulk-contact-title',
    aliases: CONTACT_TITLE_WORDS,
  },
  {
    key: 'phone',
    label: 'Phone',
    header: 'phone',
    group: 'core',
    controlId: 'bulk-contact-phone',
    aliases: CONTACT_PHONE_WORDS,
  },
  {
    key: 'email',
    label: 'Email',
    header: 'email',
    group: 'core',
    controlId: 'bulk-contact-email',
    aliases: CONTACT_EMAIL_WORDS,
  },
  {
    key: 'website',
    label: 'Website',
    header: 'website',
    group: 'core',
    controlId: 'bulk-contact-website',
    aliases: CONTACT_WEBSITE_WORDS,
  },
  {
    key: 'street',
    label: 'Street',
    header: 'street',
    group: 'postal',
    controlId: 'bulk-contact-street',
    aliases: CONTACT_STREET_WORDS,
  },
  {
    key: 'city',
    label: 'City',
    header: 'city',
    group: 'postal',
    controlId: 'bulk-contact-city',
    aliases: CONTACT_CITY_WORDS,
  },
  {
    key: 'zip',
    label: 'Postal Code',
    header: 'postal_code',
    group: 'postal',
    controlId: 'bulk-contact-zip',
    aliases: CONTACT_ZIP_WORDS,
  },
  {
    key: 'country',
    label: 'Country',
    header: 'country',
    group: 'postal',
    controlId: 'bulk-contact-country',
    aliases: CONTACT_COUNTRY_WORDS,
  },
];

const WEBSITE_BARE_TLDS = new Set([
  'com',
  'org',
  'net',
  'io',
  'co',
  'edu',
  'gov',
  'dev',
  'app',
  'example',
]);

function isSampleWebsiteValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('@') || /\s/.test(trimmed)) return false;
  if (/^(?:https?:\/\/|www\.)\S/i.test(trimmed)) return true;
  const slashIdx = trimmed.indexOf('/');
  const host = (slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx)).toLowerCase();
  const parts = host.split('.');
  if (parts.length < 2 || parts.some((p) => !p || !/^[a-z0-9-]+$/.test(p))) return false;
  const tld = parts[parts.length - 1];
  return slashIdx !== -1 ? tld.length >= 2 && /^[a-z]+$/.test(tld) : WEBSITE_BARE_TLDS.has(tld);
}

/**
 * Checks whether the given bulk content type indicates contact card synthesis.
 */
export function isContactContentType(contentType?: BulkContentType): boolean {
  return contentType === 'vcard' || contentType === 'contact';
}

function exactHeaderTokens(header: string): string[] {
  const normalized = header.toLowerCase().trim();
  const rawClean = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  const rawUnderscore = normalized.replace(/[^\p{L}\p{N}]+/gu, '_');
  const set = new Set<string>();
  if (normalized) set.add(normalized);
  if (rawClean) set.add(rawClean);
  if (rawUnderscore) set.add(rawUnderscore);
  return Array.from(set);
}

/** Splits a header into lowercase words and normalized tokens. */
export function headerWords(header: string): string[] {
  const set = new Set<string>(exactHeaderTokens(header));
  const splitWords = header
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  for (const word of splitWords) {
    set.add(word);
  }
  return Array.from(set);
}

function matchColumn(
  columns: string[],
  words: readonly string[],
  excluded: Set<string>,
  tokenize: (header: string) => string[] = headerWords
): string | undefined {
  let bestCandidate: string | undefined;
  let bestRank = Infinity;

  for (const col of columns) {
    if (excluded.has(col)) continue;
    const tokens = tokenize(col);
    for (const token of tokens) {
      const rank = words.indexOf(token);
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        bestCandidate = col;
      }
    }
  }

  return bestCandidate;
}

function detectColumnFromSamples(
  columns: string[],
  rows: CsvRow[],
  excluded: Set<string>,
  predicate: (value: string) => boolean
): string | undefined {
  if (rows.length === 0) return undefined;
  const sample = rows.slice(0, 10);
  for (const col of columns) {
    if (excluded.has(col)) continue;
    const hasMatch = sample.some((row) => predicate((row[col] ?? '').trim()));
    if (hasMatch) return col;
  }
  return undefined;
}

/**
 * Heuristically auto-detects column mappings for contact card fields based on header names and sample cells.
 *
 * @param columns Header names.
 * @param rows Optional sample rows to disambiguate content types.
 * @returns Auto-detected contact mapping.
 */
export function autoDetectContactMapping(
  columns: string[],
  rows: CsvRow[] = []
): BulkContactMapping {
  const mapping: BulkContactMapping = {};
  const used = new Set<string>();

  const assign = (key: keyof BulkContactMapping, col: string | undefined): void => {
    if (!col || mapping[key]) return;
    mapping[key] = col;
    used.add(col);
  };

  // Separate explicit first name words from generic 'name' words so Last Name claims its column before generic Name fallback.
  const explicitFirstNameWords = CONTACT_FIRST_NAME_WORDS.filter(
    (w) => w !== 'name' && w !== 'contact' && !w.includes('full')
  );
  const lastNameDescriptor = BULK_CONTACT_FIELDS.find((f) => f.key === 'lastName');
  const orderedOrder: readonly (keyof BulkContactMapping)[] = [
    'email',
    'phone',
    'website',
    'organization',
    'title',
    'street',
    'city',
    'zip',
    'country',
  ];

  // 1. Exact full-header pass so compound headers like "Company Website" or "Office Address" match their exact field first.
  assign('firstName', matchColumn(columns, explicitFirstNameWords, used, exactHeaderTokens));
  if (lastNameDescriptor) {
    assign('lastName', matchColumn(columns, lastNameDescriptor.aliases, used, exactHeaderTokens));
  }
  for (const key of orderedOrder) {
    const descriptor = BULK_CONTACT_FIELDS.find((f) => f.key === key);
    if (descriptor) {
      assign(key, matchColumn(columns, descriptor.aliases, used, exactHeaderTokens));
    }
  }

  // 2. Word-token pass for composite headers and generic Name fallback.
  if (!mapping.firstName) {
    const explicitFirstCol = matchColumn(columns, explicitFirstNameWords, used);
    if (lastNameDescriptor && !mapping.lastName) {
      assign('lastName', matchColumn(columns, lastNameDescriptor.aliases, used));
    }
    assign('firstName', explicitFirstCol ?? matchColumn(columns, CONTACT_FIRST_NAME_WORDS, used));
  } else if (lastNameDescriptor && !mapping.lastName) {
    assign('lastName', matchColumn(columns, lastNameDescriptor.aliases, used));
  }

  for (const key of orderedOrder) {
    if (mapping[key]) continue;
    const descriptor = BULK_CONTACT_FIELDS.find((f) => f.key === key);
    if (descriptor) {
      assign(key, matchColumn(columns, descriptor.aliases, used));
    }
  }

  // 3. Sample-row value fallbacks for email, phone, and website when headers are unspecific.
  if (!mapping.email) {
    assign(
      'email',
      detectColumnFromSamples(
        columns,
        rows,
        used,
        (val) => val.includes('@') && CONTAINMENT_PROFILES.EMAIL.test(val)
      )
    );
  }
  if (!mapping.phone) {
    assign(
      'phone',
      detectColumnFromSamples(
        columns,
        rows,
        used,
        (val) => val.length >= 7 && /^(\+?[0-9\s()./-]+)$/.test(val) && /\d{3,}/.test(val)
      )
    );
  }
  if (!mapping.website) {
    assign('website', detectColumnFromSamples(columns, rows, used, isSampleWebsiteValue));
  }

  return mapping;
}

export interface SynthesizedVCardResult {
  payload: string;
  vcardData: VCardData;
  hasAnyData: boolean;
  hasIdentity: boolean;
  violations: string[];
}

/**
 * Synthesizes an RFC 6350 compliant vCard payload from a CSV data row using the specified mapping.
 * Performs format checks, identity verification, control character rejection, and dangerous URL checks.
 *
 * @param row The CSV row.
 * @param mapping The column mapping for contact card fields.
 * @param version Target vCard version (defaults to '3.0').
 * @returns Synthesized vCard payload and validation results.
 */
export function synthesizeVCardPayload(
  row: CsvRow,
  mapping: BulkContactMapping,
  version: VCardData['version'] = '3.0'
): SynthesizedVCardResult {
  const values: Record<keyof BulkContactMapping, string> = {
    firstName: '',
    lastName: '',
    organization: '',
    title: '',
    phone: '',
    ['email']: '',
    website: '',
    street: '',
    city: '',
    zip: '',
    country: '',
  };

  for (const { key } of BULK_CONTACT_FIELDS) {
    const col = mapping[key];
    values[key] = col ? (row[col] ?? '').trim() : '';
  }

  const hasAnyData = BULK_CONTACT_FIELDS.some(({ key }) => Boolean(values[key]));
  const hasIdentity = Boolean(values.firstName || values.lastName || values.organization);

  const violations: string[] = [];

  // 1. Control character & bidi checks across all eleven mapped contact fields
  for (const { key, label } of BULK_CONTACT_FIELDS) {
    const val = values[key];
    if (!val) continue;
    if (REGEX_STRICT_CONTROL_NO_G.test(val) || CONTAINMENT_PROFILES.TEXT_NO_CONTROL.test(val)) {
      violations.push(`${label} contains invalid control or zero-width characters`);
    }
    if (CONTAINMENT_PROFILES.BIDI_CONTROL.test(val)) {
      violations.push(`${label} contains hidden text-direction characters`);
    }
  }

  // 2. Dangerous URL checks
  const emailValue = values.email;
  const website = values.website;
  const phone = values.phone;
  if (website && isDangerousUrl(website)) {
    violations.push('Website contains unsafe URL scheme or dangerous payload');
  }
  if (emailValue && isDangerousUrl(emailValue)) {
    violations.push('Email contains unsafe URL scheme or dangerous payload');
  }
  if (phone && isDangerousUrl(phone)) {
    violations.push('Phone contains unsafe URL scheme or dangerous payload');
  }

  // 3. Email format check (if present)
  if (emailValue && !CONTAINMENT_PROFILES.EMAIL.test(emailValue)) {
    violations.push(`Invalid email address format '${emailValue}'`);
  }

  const vcardData: VCardData = {
    version,
    firstName: values.firstName,
    lastName: values.lastName,
    organization: values.organization,
    title: values.title,
    phone,
    ['email']: emailValue,
    website,
    street: values.street,
    city: values.city,
    state: '',
    zip: values.zip,
    country: values.country,
  };

  const payload = hasAnyData ? constructVCardString(vcardData) : '';

  return {
    payload,
    vcardData,
    hasAnyData,
    hasIdentity,
    violations,
  };
}
