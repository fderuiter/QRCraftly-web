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


import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Page from './+Page';
import { getPageSchema } from '@/data/pageContent';

// Mock QRTool component since we only want to test if it's passed correct props
vi.mock('../../components/QRTool', () => ({
  default: ({ initialConfig }: any) => (
    <div data-testid="qr-tool-mock">
      QRTool with type: {initialConfig?.type}
    </div>
  ),
}));

describe('WiFi QR Code Page', () => {
  it('renders QRTool with WiFi configuration', () => {
    render(<Page />);
    
    const qrTool = screen.getByTestId('qr-tool-mock');
    expect(qrTool).toBeInTheDocument();
    expect(qrTool).toHaveTextContent('QRTool with type: WIFI');
  });

  it('renders structured data schema', () => {
    // Head renders the page's structured data at prerender time (#1058).
    const json = JSON.parse(JSON.stringify(getPageSchema('/wifi-qr-code')));
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@graph']).toBeDefined();
    expect(json['@graph']).toHaveLength(3); // WebApplication, HowTo and FAQPage
    const faq = json['@graph'].find((item: any) => item['@type'] === 'FAQPage');
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);

    const webApp = json['@graph'].find((item: any) => Array.isArray(item['@type']) && item['@type'].includes('SoftwareApplication') && item['@type'].includes('WebApplication'));
    expect(webApp).toBeDefined();

    // Check for critical SEO properties
    expect(webApp.softwareVersion).toBe(__APP_VERSION__);
    expect(webApp.image).toBe('https://qrcraftly.com/og/wifi-qr-code.png');
    expect(webApp.datePublished).toBeUndefined();
    expect(webApp.browserRequirements).toBe('Requires JavaScript. Works in all modern browsers.');
    expect(webApp.author).toEqual({
      '@id': 'https://qrcraftly.com/#organization'
    });

    // Check HowTo schema properties
    const howTo = json['@graph'].find((item: any) => item['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect(howTo.totalTime).toBe('PT1M');
    expect(howTo.estimatedCost).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: '0'
    });

    expect(howTo.supply).toHaveLength(3);
    expect(howTo.supply[0].name).toBe('WiFi Network Name (SSID)');
    expect(howTo.supply[1].name).toBe('WiFi Password');
    expect(howTo.supply[2].name).toBe('Encryption Type');

    expect(howTo.tool).toHaveLength(1);
    expect(howTo.tool[0].name).toBe('QRCraftly WiFi Generator');

    expect(howTo.step).toHaveLength(4);
  });
});
