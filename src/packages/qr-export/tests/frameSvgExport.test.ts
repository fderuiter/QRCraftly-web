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

import { describe, it, expect } from 'vitest';
// @ts-expect-error - jsdom type declarations might not be installed
import { JSDOM } from 'jsdom';
import { generateQRSvg } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { QRConfig } from '@/types';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = dom.window.document;
  }
}

describe('SVG Export with Frame Shapes & CTA Badges', () => {
  it('includes frame text and path nodes in generated SVG', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      frameStyle: 'banner',
      frameText: 'DISCOVER MORE',
      framePosition: 'bottom',
      frameIcon: 'star',
      frameBgColor: '#10b981',
      frameTextColor: '#ffffff',
    };

    const svg = await generateQRSvg(config);

    expect(svg).toContain('DISCOVER MORE');
    expect(svg).toContain('path');
    expect(svg).toContain('text');
  });
});
