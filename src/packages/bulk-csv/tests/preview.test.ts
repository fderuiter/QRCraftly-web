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

import { describe, it, expect } from 'vitest';
import { previewRow, pickColumn, PAYLOAD_COLUMN_WORDS, FILENAME_COLUMN_WORDS } from '../index';

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
    expect(pickColumn(['Video URL', 'Title'], FILENAME_COLUMN_WORDS, 'Video URL')).toBe('Title');
    expect(pickColumn(['Name', 'Metadata', 'URL'], PAYLOAD_COLUMN_WORDS)).toBe('URL');
    expect(pickColumn(['Guide link', 'Name'], FILENAME_COLUMN_WORDS, 'Guide link')).toBe('Name');
    expect(pickColumn(['product_id', 'landingPageUrl'], PAYLOAD_COLUMN_WORDS)).toBe('landingPageUrl');
  });

  it('never picks the excluded column while another one exists', () => {
    expect(pickColumn(['Product', 'Landing page'], FILENAME_COLUMN_WORDS, 'Product')).toBe('Landing page');
    expect(pickColumn(['url'], FILENAME_COLUMN_WORDS, 'url')).toBe('url');
  });
});
