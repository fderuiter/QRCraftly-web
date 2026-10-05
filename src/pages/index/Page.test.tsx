/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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


import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Page from './+Page';
import { getPageSchema } from '@/data/pageContent';

// Mock QRTool to avoid rendering complex children
vi.mock('../../components/QRTool', () => ({
  default: () => <div data-testid="qr-tool-mock">QRTool</div>,
}));

describe('Home Page', () => {
  it('renders structured data with required SEO properties', () => {
    // Head renders the page's structured data at prerender time (#1058).
    const json = JSON.parse(JSON.stringify(getPageSchema('/')));
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@graph']).toBeDefined();

    const graph = json['@graph'];
    expect(Array.isArray(graph)).toBe(true);

    const webApp = graph.find((item: any) => Array.isArray(item['@type']) && item['@type'].includes('SoftwareApplication') && item['@type'].includes('WebApplication'));
    expect(webApp).toBeDefined();
    expect(webApp.name).toBe('QRCraftly');
    expect(webApp.author).toEqual({
      '@id': 'https://qrcraftly.com/#organization'
    });

    // Check for critical SEO properties
    expect(webApp.softwareVersion).toBe(__APP_VERSION__);
    expect(webApp.image).toBe('https://qrcraftly.com/og/index.png');
    expect(webApp.datePublished).toBeUndefined();
    expect(webApp.browserRequirements).toBe('Requires JavaScript. Works in all modern browsers.');
  });
});
