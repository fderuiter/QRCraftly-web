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

import type { TypeGuide } from './typeGuides';

/** One FAQ entry built from a guide section: paragraphs, a bullet list, or both, and an optional link to the security page. */
export interface GuideFaq {
  question: string;
  paragraphs: readonly string[];
  items?: readonly string[];
  linksToSecurity?: boolean;
}

/**
 * Turns a page's background sections into optional FAQ answers (#1354).
 * @param guide - The page's guide.
 * @returns The questions, in the order they appear on the page.
 */
export function getGuideFaqs(guide: TypeGuide): GuideFaq[] {
  return [
    { question: 'What happens when someone scans it?', paragraphs: guide.scanned },
    { question: 'What can I use it for?', paragraphs: [], items: guide.useCases },
    { question: 'How do I print it so it scans?', paragraphs: [], items: guide.printing },
    { question: 'What should I check before I share it?', paragraphs: [], items: guide.checks },
    {
      question: 'Where does what I type go?',
      paragraphs: [guide.privacy],
      linksToSecurity: true,
    },
  ];
}

/**
 * Flattens a guide FAQ to plain text for FAQPage structured data.
 * @param faq - The guide FAQ.
 * @returns Its answer as one string.
 */
export function guideFaqAnswer(faq: GuideFaq): string {
  return [...faq.paragraphs, ...(faq.items ?? [])].join(' ');
}
