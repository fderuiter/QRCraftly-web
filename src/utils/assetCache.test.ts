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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error - jsdom type declarations might not be installed
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM();
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
}

import { getCachedAsset, setCachedAsset, clearAssetCache, convertImageToBase64 } from './assetCache';
import { generateQRSvg } from '@/packages/qr-export';
import { DEFAULT_CONFIG } from '../constants';
import type { QRConfig } from '../types';

describe('Asset Cache Utility', () => {
  beforeEach(() => {
    clearAssetCache();
  });

  afterEach(() => {
    clearAssetCache();
  });

  it('stores and retrieves cached assets correctly', () => {
    const url = 'https://example.com/logo.png';
    const base64 = 'data:image/png;base64,mocklogo';

    expect(getCachedAsset(url)).toBeNull();

    setCachedAsset(url, base64);
    expect(getCachedAsset(url)).toBe(base64);
  });

  it('handles null or empty inputs gracefully', () => {
    expect(getCachedAsset('')).toBeNull();
    
    // Setting invalid inputs should not crash or cache
    setCachedAsset('', 'data:image/png;base64,mock');
    setCachedAsset('https://example.com/logo.png', '');
    
    expect(getCachedAsset('https://example.com/logo.png')).toBeNull();
  });

  it('clears all cached assets when clearAssetCache is called', () => {
    setCachedAsset('https://example.com/logo1.png', 'data:image/png;base64,mock1');
    setCachedAsset('https://example.com/logo2.png', 'data:image/png;base64,mock2');

    expect(getCachedAsset('https://example.com/logo1.png')).toBe('data:image/png;base64,mock1');
    expect(getCachedAsset('https://example.com/logo2.png')).toBe('data:image/png;base64,mock2');

    clearAssetCache();

    expect(getCachedAsset('https://example.com/logo1.png')).toBeNull();
    expect(getCachedAsset('https://example.com/logo2.png')).toBeNull();
  });

  it('convertImageToBase64 handles invalid images or environments safely without throwing', () => {
    // If not HTMLImageElement or lacks dimensions, return null
    const invalidImg = {} as HTMLImageElement;
    expect(convertImageToBase64(invalidImg)).toBeNull();
  });

  it('SVG generator retrieves logo from cache and makes zero redundant HTTP requests', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake image data'], { type: 'image/png' })),
    });
    global.fetch = fetchSpy;

    try {
      const logoUrl = 'https://example.com/cached-logo.png';
      const base64Data = 'data:image/png;base64,cached_data_uri_representation';

      // Manually pre-populate the cache (simulating preview loading completion)
      setCachedAsset(logoUrl, base64Data);

      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: logoUrl,
      };

      // Generate SVG
      const svg = await generateQRSvg(config);

      // Verify cached image is successfully embedded
      expect(svg).toContain(base64Data);

      // Verify no HTTP requests are triggered for the cached logo
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('SVG generator falls back gracefully to network fetch when logo is not in cache', async () => {
    const originalFetch = global.fetch;
    const originalFileReader = global.FileReader;

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['network image data'], { type: 'image/png' })),
    });
    global.fetch = fetchSpy;

    class MockFileReader {
      onload: () => void = () => {};
      result = 'data:image/png;base64,network_data_uri_from_fetch';
      readAsDataURL() {
        this.onload();
      }
    }
    global.FileReader = MockFileReader as any;

    try {
      const logoUrl = 'https://example.com/uncached-logo.png';
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: logoUrl,
      };

      // Ensure cache is completely empty for this url
      expect(getCachedAsset(logoUrl)).toBeNull();

      // Generate SVG
      const svg = await generateQRSvg(config);

      // Verify fetched image is embedded
      expect(svg).toContain('data:image/png;base64,network_data_uri_from_fetch');

      // Verify HTTP fetch was indeed triggered since it was not in the cache
      expect(fetchSpy).toHaveBeenCalledWith(logoUrl, expect.objectContaining({ mode: 'cors' }));
    } finally {
      global.fetch = originalFetch;
      global.FileReader = originalFileReader;
    }
  });
});
