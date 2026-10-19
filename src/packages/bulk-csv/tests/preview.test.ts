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

import { describe, it, expect, vi } from 'vitest';
import { previewRow, pickColumn, hasPayload, PAYLOAD_COLUMN_WORDS, FILENAME_COLUMN_WORDS } from '../index';

describe('previewRow', () => {
  it('returns the first row that has a payload, with its position', () => {
    const csv = 'url,name\n,Empty\nhttps://a.example,A\nhttps://b.example,B';
    expect(previewRow(csv, 'url')).toEqual({ payload: 'https://a.example/', rowNumber: 2, rowCount: 3 });
  });

  it('uses the detected payload column when the chosen one is missing', () => {
    expect(previewRow('title,qr\nHello,  WIFI:S:x;;  ', 'nope', 'text')?.payload).toBe('WIFI:S:x;;');
  });

  it('numbers the row as a spreadsheet does, counting blank lines (#1291)', () => {
    expect(previewRow('url\n\n\nhttps://a.example', 'url')?.rowNumber).toBe(3);
  });

  it('returns null when there is nothing to preview', () => {
    expect(previewRow('', 'url')).toBeNull();
    expect(previewRow('url\n', 'url')).toBeNull();
    expect(previewRow('url\n"unterminated', 'url')).toBeNull();
  });

  it('re-throws non-CsvParseError errors in previewRow', async () => {
    const csvModule = await import('../lib/csv');
    const spy = vi.spyOn(csvModule, 'parseCsv').mockImplementationOnce(() => {
      throw new TypeError('Unexpected runtime exception');
    });
    expect(() => previewRow('a,b\n1,2', 'a')).toThrow(TypeError);
    spy.mockRestore();
  });
});

describe('pickColumn', () => {
  it('prefers a matching header, then the first column', () => {
    expect(pickColumn(['id', 'link'], PAYLOAD_COLUMN_WORDS)).toBe('link');
    expect(pickColumn(['code', 'value'], PAYLOAD_COLUMN_WORDS)).toBe('code');
    expect(pickColumn(['url', 'label'], FILENAME_COLUMN_WORDS)).toBe('label');
    expect(pickColumn([], PAYLOAD_COLUMN_WORDS)).toBe('');
  });

  it('matches whole words, not substrings (#1291)', () => {
    expect(pickColumn(['Video URL', 'Title'], PAYLOAD_COLUMN_WORDS)).toBe('Video URL');
    expect(pickColumn(['Video URL', 'Title'], FILENAME_COLUMN_WORDS, { exclude: 'Video URL' })).toBe('Title');
    expect(pickColumn(['Name', 'Metadata', 'URL'], PAYLOAD_COLUMN_WORDS)).toBe('URL');
    expect(pickColumn(['Guide link', 'Name'], FILENAME_COLUMN_WORDS, { exclude: 'Guide link' })).toBe('Name');
    expect(pickColumn(['product_id', 'landingPageUrl'], PAYLOAD_COLUMN_WORDS)).toBe('landingPageUrl');
  });

  it('never picks the excluded column while another one exists', () => {
    expect(pickColumn(['Product', 'Landing page'], FILENAME_COLUMN_WORDS, { exclude: 'Product' })).toBe('Landing page');
    expect(pickColumn(['url'], FILENAME_COLUMN_WORDS, { exclude: 'url' })).toBe('url');
  });

  it('matches expanded header aliases like promo_link, customer_url, target, and destination', () => {
    expect(pickColumn(['promo_link', 'title'], PAYLOAD_COLUMN_WORDS)).toBe('promo_link');
    expect(pickColumn(['customer_url', 'id'], PAYLOAD_COLUMN_WORDS)).toBe('customer_url');
    expect(pickColumn(['target', 'label'], PAYLOAD_COLUMN_WORDS)).toBe('target');
    expect(pickColumn(['destination', 'sku'], PAYLOAD_COLUMN_WORDS)).toBe('destination');
  });

  it('ranks strong URL/link header words above secondary header words regardless of column order', () => {
    expect(pickColumn(['Customer', 'URL'], PAYLOAD_COLUMN_WORDS)).toBe('URL');
    expect(pickColumn(['Member Name', 'Link'], PAYLOAD_COLUMN_WORDS)).toBe('Link');
    expect(pickColumn(['Campaign', 'URL'], PAYLOAD_COLUMN_WORDS)).toBe('URL');
  });

  it('performs fallback sample inspection with explicit options object and kind', () => {
    const sampleRows = [
      { ColA: 'Member_101', ColB: 'https://example.com/promo/101' },
      { ColA: 'Member_102', ColB: 'https://example.com/promo/102' },
    ];
    // ColB contains URLs, so it should be picked as payload column over ColA when kind is 'payload'
    expect(pickColumn(['ColA', 'ColB'], PAYLOAD_COLUMN_WORDS, { rows: sampleRows, kind: 'payload' })).toBe('ColB');
    // For filename column excluding ColB, ColA with plain text should be picked when kind is 'filename'
    expect(pickColumn(['ColA', 'ColB'], FILENAME_COLUMN_WORDS, { exclude: 'ColB', rows: sampleRows, kind: 'filename' })).toBe('ColA');
  });

  it('performs fallback sample inspection with a copied or filtered word list when kind is omitted', () => {
    const sampleRows = [
      { ColA: 'Member_101', ColB: 'https://example.com/promo/101' },
      { ColA: 'Member_102', ColB: 'https://example.com/promo/102' },
    ];
    const copiedPayloadWords = [...PAYLOAD_COLUMN_WORDS];
    const copiedFilenameWords = [...FILENAME_COLUMN_WORDS];
    expect(pickColumn(['ColA', 'ColB'], copiedPayloadWords, { rows: sampleRows })).toBe('ColB');
    expect(pickColumn(['ColA', 'ColB'], copiedFilenameWords, { exclude: 'ColB', rows: sampleRows })).toBe('ColA');
  });

  it('handles unknown words and zero-match sample inspection fallbacks', () => {
    // Unknown words where kind is undefined and no matching headers
    expect(pickColumn(['ColA', 'ColB'], ['unknown_word'])).toBe('ColA');

    // Kind payload but no sample cells match payload pattern
    const plainRows = [{ ColA: 'plain text 1', ColB: 'plain text 2' }];
    expect(pickColumn(['ColA', 'ColB'], ['unknown'], { rows: plainRows, kind: 'payload' })).toBe('ColA');

    // Kind filename where all sample cells are payloads or empty/non-string
    const urlRows = [
      { ColA: 'https://example.com', ColB: '   ', ColC: 123 as unknown as string },
    ];
    expect(pickColumn(['ColA', 'ColB'], ['unknown'], { rows: urlRows, kind: 'filename' })).toBe('ColA');
  });

  it('handles empty candidates or empty column arrays gracefully', () => {
    expect(pickColumn([], [])).toBe('');
    expect(pickColumn(['onlyCol'], ['word'], { exclude: 'onlyCol' })).toBe('onlyCol');
  });
});

describe('hasPayload', () => {
  it('identifies valid payload values and rejects missing, non-string, or blank cells', () => {
    expect(hasPayload({ col: '  https://example.com  ' }, 'col')).toBe(true);
    expect(hasPayload({ col: '   ' }, 'col')).toBe(false);
    expect(hasPayload({}, 'col')).toBe(false);
    expect(hasPayload({ col: 123 as unknown as string }, 'col')).toBe(false);
  });
});
