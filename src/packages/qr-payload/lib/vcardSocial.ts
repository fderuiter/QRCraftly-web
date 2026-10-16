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

import type { VCardData } from '@/types';
import { isDangerousUrl } from '@/utils/security';

/** A social network a contact card can link to. */
interface SocialNetwork {
  /** The VCardData field that holds the handle or link. */
  field: VCardSocialField;
  /** The network's name, as shown in the form. */
  name: string;
  /** The `TYPE=` value on the card's `URL` line. */
  type: string;
  /** Hosts a pasted profile link may use, after `www.`, `m.` or `mobile.` is removed. */
  hosts: readonly string[];
  /** The profile link for a bare handle. */
  profileUrl: (handle: string) => string;
}

/** The social profile fields of a contact card, in form order. */
export const VCARD_SOCIAL_FIELDS = ['x', 'linkedin', 'instagram', 'facebook', 'github'] as const satisfies readonly (keyof VCardData)[];

export type VCardSocialField = (typeof VCARD_SOCIAL_FIELDS)[number];

/** The networks, keyed by field (#1470). */
export const VCARD_SOCIAL_NETWORKS: Readonly<Record<VCardSocialField, SocialNetwork>> = {
  x: { field: 'x', name: 'X', type: 'x', hosts: ['x.com', 'twitter.com'], profileUrl: (h) => `https://x.com/${h}` },
  linkedin: {
    field: 'linkedin',
    name: 'LinkedIn',
    type: 'linkedin',
    hosts: ['linkedin.com'],
    profileUrl: (h) => `https://www.linkedin.com/in/${h}`,
  },
  instagram: {
    field: 'instagram',
    name: 'Instagram',
    type: 'instagram',
    hosts: ['instagram.com'],
    profileUrl: (h) => `https://www.instagram.com/${h}`,
  },
  facebook: {
    field: 'facebook',
    name: 'Facebook',
    type: 'facebook',
    hosts: ['facebook.com', 'fb.com'],
    profileUrl: (h) => `https://www.facebook.com/${h}`,
  },
  github: { field: 'github', name: 'GitHub', type: 'github', hosts: ['github.com'], profileUrl: (h) => `https://github.com/${h}` },
};

/**
 * A bare handle: what the networks allow in a user name, without the leading `@`. It needs a
 * letter or digit, because a link parser turns a path of only dots (`.`, `..`) into another path.
 */
const HANDLE_PATTERN = /^(?=[^A-Za-z0-9]*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/;

/** A host without `www.`, `m.` or `mobile.`. */
const bareHost = (host: string): string => host.toLowerCase().replace(/^(www|m|mobile)\./, '');

/** A scheme at the start of a value, such as `https:`. */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** The result of reading a social profile field. */
export type SocialProfileResult = { url: string; error?: undefined } | { url?: undefined; error: string };

/**
 * Turns what was typed in a social profile field into the profile link the card carries. A
 * handle (`jane`, `@jane`) becomes the network's profile link; a full link is kept only on that
 * network's own host, upgraded to `https`. The result is stable: reading its own output gives it back.
 * @param field - The social field.
 * @param value - The typed handle or link.
 * @returns The profile link, an error sentence, or `null` when the field is blank.
 */
export const socialProfileUrl = (field: VCardSocialField, value: string | undefined): SocialProfileResult | null => {
  const network = VCARD_SOCIAL_NETWORKS[field];
  const typed = (value || '').trim();
  if (!typed) return null;
  if (isDangerousUrl(typed)) return { error: 'Unsafe URL scheme or malicious protocol detected.' };

  // `github.com` on its own is a link with no user name, not the user name "github.com".
  const isLink = SCHEME_PATTERN.test(typed) || typed.includes('/') || network.hosts.includes(bareHost(typed));
  if (!isLink) {
    const handle = typed.replace(/^@/, '');
    if (!HANDLE_PATTERN.test(handle)) {
      return { error: `Enter a ${network.name} user name, or paste your profile link.` };
    }
    return { url: network.profileUrl(handle) };
  }

  let link: URL;
  try {
    link = new URL(SCHEME_PATTERN.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { error: `Enter a ${network.name} user name, or paste your profile link.` };
  }
  const host = bareHost(link.hostname);
  if ((link.protocol !== 'https:' && link.protocol !== 'http:') || !network.hosts.includes(host)) {
    return { error: `This link is not on ${network.hosts[0]}. Enter your ${network.name} user name or profile link.` };
  }
  if (link.pathname.length <= 1) {
    return { error: `Add your ${network.name} user name to the link.` };
  }
  link.protocol = 'https:';
  link.hash = '';
  // `;` and `,` separate vCard values, and a profile link never needs them.
  if (/[;,\\]/.test(link.href) || link.username || link.password) {
    return { error: `Enter a ${network.name} user name, or paste your profile link.` };
  }
  return { url: link.href };
};

/**
 * The network a card's `URL;TYPE=…` line belongs to.
 * @param params - The property parameters, such as `;TYPE=linkedin`.
 * @returns The social field, or `null` for a plain website link.
 */
export const socialFieldForParams = (params: string): VCardSocialField | null => {
  const types = (/(?:^|;)TYPE=([^;:]+)/i.exec(params)?.[1] || '').toLowerCase().split(',');
  return VCARD_SOCIAL_FIELDS.find((field) => types.includes(VCARD_SOCIAL_NETWORKS[field].type)) ?? null;
};
