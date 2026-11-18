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
import {
  isDangerousUrl,
  REGEX_STRICT_CONTROL_CHARS,
  REGEX_BIDI_CONTROL_CHARS,
} from '@/packages/core/security';
import { CONTAINMENT_PROFILES } from '../protocol';

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

/**
 * Checks whether the given bulk content type indicates contact card synthesis.
 */
export function isContactContentType(contentType?: BulkContentType): boolean {
  return contentType === 'vcard' || contentType === 'contact';
}

/** Splits a header into lowercase words and normalized tokens. */
export function headerWords(header: string): string[] {
  const normalized = header.toLowerCase().trim();
  const rawClean = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  const rawUnderscore = normalized.replace(/[^\p{L}\p{N}]+/gu, '_');
  const splitWords = header
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const set = new Set<string>();
  if (normalized) set.add(normalized);
  if (rawClean) set.add(rawClean);
  if (rawUnderscore) set.add(rawUnderscore);
  for (const word of splitWords) {
    set.add(word);
  }
  return Array.from(set);
}

function matchColumn(
  columns: string[],
  words: readonly string[],
  excluded: Set<string>
): string | undefined {
  let bestCandidate: string | undefined;
  let bestRank = Infinity;

  for (const col of columns) {
    if (excluded.has(col)) continue;
    const tokens = headerWords(col);
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

  // 1. Separate explicit first name words from generic 'name' words
  const explicitFirstNameWords = CONTACT_FIRST_NAME_WORDS.filter(
    (w) => w !== 'name' && w !== 'contact' && !w.includes('full')
  );
  let firstNameCol = matchColumn(columns, explicitFirstNameWords, used);

  // 2. Last name
  const lastNameCol = matchColumn(columns, CONTACT_LAST_NAME_WORDS, used);
  if (lastNameCol) {
    mapping.lastName = lastNameCol;
    used.add(lastNameCol);
  }

  // If no explicit first name was found, but a generic 'name' column exists, map it to firstName
  if (!firstNameCol) {
    firstNameCol = matchColumn(columns, CONTACT_FIRST_NAME_WORDS, used);
  }
  if (firstNameCol) {
    mapping.firstName = firstNameCol;
    used.add(firstNameCol);
  }

  // 3. Email
  let emailCol = matchColumn(columns, CONTACT_EMAIL_WORDS, used);
  if (!emailCol && rows.length > 0) {
    // Fallback: check sample rows for @ symbol and email regex
    const sample = rows.slice(0, 10);
    for (const col of columns) {
      if (used.has(col)) continue;
      const matchCount = sample.filter((r) => {
        const val = (r[col] ?? '').trim();
        return val.includes('@') && CONTAINMENT_PROFILES.EMAIL.test(val);
      }).length;
      if (matchCount > 0) {
        emailCol = col;
        break;
      }
    }
  }
  if (emailCol) {
    mapping['email'] = emailCol;
    used.add(emailCol);
  }

  // 4. Phone
  let phoneCol = matchColumn(columns, CONTACT_PHONE_WORDS, used);
  if (!phoneCol && rows.length > 0) {
    const sample = rows.slice(0, 10);
    for (const col of columns) {
      if (used.has(col)) continue;
      const matchCount = sample.filter((r) => {
        const val = (r[col] ?? '').trim();
        return val.length >= 7 && /^(\+?[0-9\s()./-]+)$/.test(val) && /\d{3,}/.test(val);
      }).length;
      if (matchCount > 0) {
        phoneCol = col;
        break;
      }
    }
  }
  if (phoneCol) {
    mapping.phone = phoneCol;
    used.add(phoneCol);
  }

  // 5. Organization
  const orgCol = matchColumn(columns, CONTACT_ORG_WORDS, used);
  if (orgCol) {
    mapping.organization = orgCol;
    used.add(orgCol);
  }

  // 6. Title
  const titleCol = matchColumn(columns, CONTACT_TITLE_WORDS, used);
  if (titleCol) {
    mapping.title = titleCol;
    used.add(titleCol);
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
  const firstName = mapping.firstName ? (row[mapping.firstName] ?? '').trim() : '';
  const lastName = mapping.lastName ? (row[mapping.lastName] ?? '').trim() : '';
  const organization = mapping.organization ? (row[mapping.organization] ?? '').trim() : '';
  const title = mapping.title ? (row[mapping.title] ?? '').trim() : '';
  const phone = mapping.phone ? (row[mapping.phone] ?? '').trim() : '';
  const emailValue = mapping.email ? (row[mapping.email] ?? '').trim() : '';
  const website = mapping.website ? (row[mapping.website] ?? '').trim() : '';

  const hasAnyData = Boolean(
    firstName || lastName || organization || title || phone || emailValue || website
  );
  const hasIdentity = Boolean(firstName || lastName || organization);

  const violations: string[] = [];

  // 1. Control character & bidi checks across all mapped contact fields
  const fields = [
    { name: 'First Name', val: firstName },
    { name: 'Last Name', val: lastName },
    { name: 'Organization', val: organization },
    { name: 'Job Title', val: title },
    { name: 'Phone', val: phone },
    { name: 'Email', val: emailValue },
    { name: 'Website', val: website },
  ];

  for (const { name, val } of fields) {
    if (!val) continue;
    if (REGEX_STRICT_CONTROL_CHARS.test(val) || CONTAINMENT_PROFILES.TEXT_NO_CONTROL.test(val)) {
      violations.push(`${name} contains invalid control or zero-width characters`);
    }
    if (REGEX_BIDI_CONTROL_CHARS.test(val)) {
      violations.push(`${name} contains hidden text-direction characters`);
    }
  }

  // 2. Dangerous URL checks
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
    firstName,
    lastName,
    organization,
    title,
    phone,
    ['email']: emailValue,
    website,
    street: '',
    city: '',
    state: '',
    zip: '',
    country: '',
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
