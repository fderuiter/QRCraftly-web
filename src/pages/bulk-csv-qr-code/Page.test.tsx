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

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Page from './+Page';
import { getPageSchema } from '@/data/pageContent';
import { copy } from '@/data/copy/bulk-csv-qr-code';
import { typeGuides } from '@/data/typeGuides';

interface SchemaNode {
  '@type'?: string | string[];
  softwareVersion?: string;
  author?: unknown;
  step?: unknown[];
}

function isSchemaGraph(value: unknown): value is { '@context': string; '@graph': SchemaNode[] } {
  return typeof value === 'object' && value !== null && '@graph' in value && Array.isArray(value['@graph']);
}

vi.mock('../../components/QRTool', () => ({
  default: ({ initialConfig }: { initialConfig?: { type?: string } }) => (
    <div data-testid="qr-tool-mock">
      QRTool with type: {initialConfig?.type}
    </div>
  ),
}));

describe('Bulk CSV QR Code Page', () => {
  it('renders QRTool with Bulk CSV configuration', () => {
    render(<Page />);

    const qrTool = screen.getByTestId('qr-tool-mock');
    expect(qrTool).toBeInTheDocument();
    expect(qrTool).toHaveTextContent('QRTool with type: BULK_CSV');
  });

  it('renders structured data schema', () => {
    // Head renders the page's structured data at prerender time (#1058).
    const json: unknown = JSON.parse(JSON.stringify(getPageSchema('/bulk-csv-qr-code')));
    if (!isSchemaGraph(json)) throw new Error('Expected a JSON-LD @graph');
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@graph']).toBeDefined();
    expect(json['@graph'].length).toBeGreaterThanOrEqual(2); // WebApplication and HowTo

    const webApp = json['@graph'].find((item) =>
      Array.isArray(item['@type']) &&
      item['@type'].includes('SoftwareApplication') &&
      item['@type'].includes('WebApplication')
    );
    expect(webApp).toBeDefined();

    expect(webApp?.softwareVersion).toBe(__APP_VERSION__);
    expect(webApp?.author).toEqual({
      '@id': 'https://qrcraftly.com/#organization'
    });

    const howTo = json['@graph'].find((item) => item['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect(howTo?.step).toHaveLength(3);
  });

  it('includes updated copy and type guide details for contact mapping and vector formats', () => {
    const json: unknown = JSON.parse(JSON.stringify(getPageSchema('/bulk-csv-qr-code')));
    if (!isSchemaGraph(json)) throw new Error('Expected a JSON-LD @graph');
    const howTo = json['@graph'].find((item) => item['@type'] === 'HowTo') as {
      step: { name: string; text: string }[];
    };
    expect(howTo).toBeDefined();
    expect(howTo.step).toHaveLength(3);
    expect(howTo.step[1].text).toMatch(/Contact Card/);
    expect(howTo.step[1].text).toMatch(/multi-column/);
    expect(howTo.step[2].text).toMatch(/PNG, SVG, EPS, or PDF/);

    expect(copy.howTo).toBeDefined();
    expect(copy.howTo?.steps[1].text.split(/\s+/).length).toBeLessThan(20);
    expect(copy.howTo?.steps[2].text.split(/\s+/).length).toBeLessThan(20);

    const formatFaq = copy.faqs?.find((f) => f.question.includes('Which formats'));
    expect(formatFaq?.answer).toMatch(/PNG/);
    expect(formatFaq?.answer).toMatch(/SVG/);
    expect(formatFaq?.answer).toMatch(/EPS/);
    expect(formatFaq?.answer).toMatch(/PDF/);

    const contactFaq = copy.faqs?.find((f) => f.question.includes('Contact Card'));
    expect(contactFaq).toBeDefined();
    expect(contactFaq?.answer).toMatch(/first name, last name, phone, email, organization, and job title/);
    expect(contactFaq?.answer).toMatch(/match automatically/);
    expect(contactFaq?.answer).toMatch(/first name, last name, or organization/);

    const bulkGuide = typeGuides['bulk-csv-qr-code'];
    expect(bulkGuide.scanned.some((s) => s.includes('contact cards') || s.includes('address books'))).toBe(true);
    expect(bulkGuide.printing.some((p) => p.includes('EPS') && p.includes('PDF'))).toBe(true);
    expect(bulkGuide.checks.some((c) => c.includes('Preflight synthesis checks'))).toBe(true);
  });
});
