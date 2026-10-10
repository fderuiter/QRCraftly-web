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

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error - jsdom type declarations might not be installed
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = dom.window.document;
    globalThis.window = dom.window as any;
    globalThis.Image = dom.window.Image as any;
    
    // Attach canvas getContext mock for JSDOM canvas element in node environment
    dom.window.HTMLCanvasElement.prototype.getContext = function (this: any, contextId: string) {
      if (contextId === '2d') {
        if (!this._mockCtx) {
          const width = this.width || 1000;
          const height = this.height || 1000;
          this._mockCtx = {
            canvas: this,
            drawImage: vi.fn(),
            getImageData: vi.fn().mockImplementation((x: number, y: number, w: number, h: number) => {
              const data = new Uint8ClampedArray((w || width) * (h || height) * 4);
              return { data, width: w || width, height: h || height };
            }),
            putImageData: vi.fn(),
            createImageData: vi.fn(),
            setTransform: vi.fn(),
            transform: vi.fn(),
            clip: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            rect: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            closePath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
          };
        }
        return this._mockCtx;
      }
      return null;
    } as any;
  }
}

import { generateQRSvg, PayloadRejectedError, rasterizeSvgToCanvas, validateSvgScannability } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { QRStyle, type QRConfig, SocialFormat, TemplateStyle, QRType } from '@/types';

function parseAndAssertValidSvg(svgString: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const parserErrors = doc.getElementsByTagName('parsererror');
  expect(parserErrors.length).toBe(0);
  return doc;
}

describe('generateQRSvg payload validation (#1152)', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'itms-services://?action=download-manifest'])(
    'rejects %s',
    async (value) => {
      await expect(generateQRSvg({ ...DEFAULT_CONFIG, type: QRType.TEXT, value })).rejects.toBeInstanceOf(PayloadRejectedError);
    },
  );

  it('lets a trusted caller opt out explicitly', async () => {
    const svg = await generateQRSvg({ ...DEFAULT_CONFIG, type: QRType.TEXT, value: 'javascript:alert(1)' }, { skipPayloadValidation: true });
    expect(svg).toContain('<svg');
  });
});

describe('generateQRSvg', () => {
  it('returns a valid SVG string for a basic URL', async () => {
    const svg = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes the correct viewport dimensions for SQUARE_1_1 (1080x1080)', async () => {
    const svg = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1080"');
    expect(svg).toContain('viewBox="0 0 1080 1080"');
  });

  it('encodes foreground colour in generated paths', async () => {
    const config = { ...DEFAULT_CONFIG, fgColor: '#123456' } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('#123456');
  });

  it('encodes background colour in generated paths', async () => {
    const config = { ...DEFAULT_CONFIG, bgColor: '#abcdef' } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('#abcdef');
  });

  it('produces SVG for MODERN style (rounded rects)', async () => {
    const config = { ...DEFAULT_CONFIG, style: QRStyle.MODERN } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('<svg');
    // MODERN uses roundRect which produces Q (quadratic Bezier) path commands
    expect(svg).toContain('Q');
  });

  it('produces SVG for SWISS style (circles)', async () => {
    const config = { ...DEFAULT_CONFIG, style: QRStyle.SWISS } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('<svg');
    // SWISS uses arcs (converted to C commands in SVG path)
    expect(svg).toContain(' C ');
  });

  it('produces SVG for FLUID style (curves)', async () => {
    const config = { ...DEFAULT_CONFIG, style: QRStyle.FLUID } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Q ');
  });

  it('produces SVG for GRUNGE style', async () => {
    const config = { ...DEFAULT_CONFIG, style: QRStyle.GRUNGE } as QRConfig;
    const svg = await generateQRSvg(config);
    parseAndAssertValidSvg(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('includes border background when border is enabled', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG as QRConfig,
      isBorderEnabled: true,
      borderSize: 0.05,
      borderColor: '#ff0000',
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('#ff0000');
  });

  it('includes border text when provided', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG as QRConfig,
      isBorderEnabled: true,
      borderSize: 0.05,
      borderText: 'Scan Me',
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('Scan Me');
    expect(svg).toContain('<text');
  });

  it('embeds logo image element when logoUrl is provided', async () => {
    // Mock fetch so toDataUrl returns the URL unchanged
    global.fetch = vi.fn().mockRejectedValue(new Error('no fetch in tests'));

    const config: QRConfig = {
      ...DEFAULT_CONFIG as QRConfig,
      logoUrl: 'data:image/png;base64,iVBORw0KGgo=',
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('omits the image if FileReader fails', async () => {
    const originalFileReader = global.FileReader;
    const originalFetch = global.fetch;

    try {
      // Create a mock FileReader that immediately triggers onerror
      class MockFileReader {
        onload: any = null;
        onerror: any = null;
        readAsDataURL() {
          if (this.onerror) {
            this.onerror(new Error('Mocked FileReader error'));
          }
        }
      }

      global.FileReader = MockFileReader as any;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(new Blob(['fake data'], { type: 'image/png' })),
      });

      const config: QRConfig = {
        ...DEFAULT_CONFIG as QRConfig,
        logoUrl: 'http://example.com/logo.png',
      };

      const svg = await generateQRSvg(config);

      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('href="http://example.com/logo.png"');
    } finally {
      global.FileReader = originalFileReader;
      global.fetch = originalFetch;
    }
  });

  it('gracefully handles an empty value string', async () => {
    // qrcode.create() throws for empty input; generateQRSvg should not crash
    const config = { ...DEFAULT_CONFIG, value: '' } as QRConfig;
    // Should reject/throw - wrapped in try/catch by the caller
    await expect(generateQRSvg(config)).rejects.toThrow();
  });

  it('generates a 9:16 SVG with 1080x1920 dimensions', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
    expect(svg).toContain('viewBox="0 0 1080 1920"');
  });

  it('generates a 4:5 SVG with 1080x1350 dimensions', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.PORTRAIT_4_5,
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
    expect(svg).toContain('viewBox="0 0 1080 1350"');
  });

  it('includes template headline text in the SVG when a template is active', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateHeadline: 'My Headline',
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('My Headline');
  });

  it('applies horizontal scaling attributes to long template headlines in the exported SVG', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateHeadline: 'Extremely long headline that goes way beyond normal boundaries and should be compressed horizontally',
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('Extremely long headline that goes way beyond normal boundaries and should be compressed horizontally');
    expect(svg).toContain('textLength=');
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
  });

  it('omits the image if a malicious protocol is used', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      logoUrl: 'javascript:alert("xss")',
    };

    const svg = await generateQRSvg(config);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('javascript:');
  });

  it('omits the image if a non-image data URL is used', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      logoUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    };

    const svg = await generateQRSvg(config);
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('data:text/html');
  });

  it('omits the image if FileReader fails to read blob', async () => {
    // Mock fetch to successfully return a blob
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake data'], { type: 'image/png' })),
    } as any);

    // Mock FileReader to fail when readAsDataURL is called
    const originalFileReader = global.FileReader;
    class MockFileReader {
      onerror: () => void = () => {};
      readAsDataURL() {
        this.onerror();
      }
    }
    global.FileReader = MockFileReader as any;

    try {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: 'https://example.com/fail-logo.png',
      };

      const svg = await generateQRSvg(config);

      // The error should be caught by the try/catch,
      // and it should gracefully omit the external URL entirely.
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('https://example.com/fail-logo.png');
    } finally {
      global.FileReader = originalFileReader;
      global.fetch = originalFetch;
    }
  });

  it('omits fr attribute for radial gradients in GRADIENT_BLUR visual template background export', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.GRADIENT_BLUR,
    };
    const svg = await generateQRSvg(config);
    expect(svg).toContain('<radialGradient');
    expect(svg).not.toContain('fr=');
  });

  describe('Accessibility tags in exported SVG', () => {
    it('generates correct title and description for a WiFi QR code', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        type: QRType.WIFI,
        value: 'WIFI:T:WPA;S:MyHomeWiFi;P:secretpassword;;',
      };
      const svg = await generateQRSvg(config);
      expect(svg).toContain('<title>WiFi Network QR Code</title>');
      expect(svg).toContain('<desc>MyHomeWiFi</desc>');
    });

    it('generates correct title and description for a URL QR code', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        type: QRType.URL,
        value: 'https://qrcraftly.com/some-page',
      };
      const svg = await generateQRSvg(config);
      expect(svg).toContain('<title>URL QR Code</title>');
      expect(svg).toContain('<desc>https://qrcraftly.com/some-page</desc>');
    });

    it('generates correct title and description for a Contact (vCard) QR code', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        type: QRType.VCARD,
        value: 'BEGIN:VCARD\nVERSION:3.0\nN:Smith;John\nFN:John Smith\nORG:A11y Corp\nEND:VCARD',
      };
      const svg = await generateQRSvg(config);
      expect(svg).toContain('<title>Contact QR Code</title>');
      expect(svg).toContain('<desc>John Smith</desc>');
    });

    it('generates correct title and description for an SMS QR code', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        type: QRType.SMS,
        value: 'SMSTO:+1234567890:Hello there',
      };
      const svg = await generateQRSvg(config);
      expect(svg).toContain('<title>SMS QR Code</title>');
      expect(svg).toContain('<desc>+1234567890</desc>');
    });
  });

  describe('Post-Export Remote Logo Omission Capturing', () => {
    it('triggers onLogoOmitted callback if a remote logo fetch fails (returns null)', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      } as any);

      try {
        const config: QRConfig = {
          ...(DEFAULT_CONFIG as QRConfig),
          logoUrl: 'https://example.com/missing-logo.png',
        };

        const onLogoOmitted = vi.fn();
        await generateQRSvg(config, { onLogoOmitted });

        expect(onLogoOmitted).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('does NOT trigger onLogoOmitted callback if a remote logo fetch succeeds', async () => {
      const originalFetch = global.fetch;
      const originalFileReader = global.FileReader;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['fake image data'], { type: 'image/png' })),
      } as any);

      class MockFileReader {
        onload: () => void = () => {};
        result = 'data:image/png;base64,ZmFrZSBpbWFnZSBkYXRh';
        readAsDataURL() {
          this.onload();
        }
      }
      global.FileReader = MockFileReader as any;

      try {
        const config: QRConfig = {
          ...(DEFAULT_CONFIG as QRConfig),
          logoUrl: 'https://example.com/success-logo.png',
        };

        const onLogoOmitted = vi.fn();
        await generateQRSvg(config, { onLogoOmitted });

        expect(onLogoOmitted).not.toHaveBeenCalled();
      } finally {
        global.FileReader = originalFileReader;
        global.fetch = originalFetch;
      }
    });

    it('does NOT trigger onLogoOmitted callback if no remote logo is configured', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: '',
      };

      const onLogoOmitted = vi.fn();
      await generateQRSvg(config, { onLogoOmitted });

      expect(onLogoOmitted).not.toHaveBeenCalled();
    });

    it('sanitizes the final generated SVG output of all malicious scripts and external resources', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=',
      };

      const svg = await generateQRSvg(config);
      parseAndAssertValidSvg(svg);
      expect(svg).not.toContain('<script>');
      expect(svg).not.toContain('alert(1)');
    });
  });

  describe('In-memory XML schema DOM parser validation suite', () => {
    it('parses exported SVG vector strings using DOMParser and asserts zero parser error tags', async () => {
      const svg = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      const parserErrors = doc.getElementsByTagName('parsererror');
      expect(parserErrors.length).toBe(0);
      expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
    });

    it('fails XML DOM validation and generates parsererror tags when malformed XML structure is injected', () => {
      const malformedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><g><rect x="0" y="0"></svg>';
      const parser = new DOMParser();
      const doc = parser.parseFromString(malformedSvg, 'image/svg+xml');
      const parserErrors = doc.getElementsByTagName('parsererror');
      expect(parserErrors.length).toBeGreaterThan(0);
    });

    it('asserts zero parser errors for complex styled QR configurations', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        style: QRStyle.MODERN,
        isBorderEnabled: true,
        borderText: 'SCAN ME',
        fgColor: '#1a56db',
        bgColor: '#f8fafc',
      };
      const svg = await generateQRSvg(config);
      parseAndAssertValidSvg(svg);
    });
  });

  describe('Offscreen SVG Raster Validation', () => {
    it('rasterizeSvgToCanvas renders generated SVG XML string onto an offscreen canvas', async () => {
      const svgString = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const canvas = await rasterizeSvgToCanvas(svgString, 1000, 1000);
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(1000);
      expect(canvas.height).toBe(1000);
      expect(canvas.getContext('2d')).not.toBeNull();
    });

    describe('rasterizeSvgToCanvas load waiting in real browsers (#969)', () => {
      type Listener = (() => void) | null;
      class ControlledImage {
        static last: ControlledImage | null = null;
        onload: Listener = null;
        onerror: ((reason: unknown) => void) | null = null;
        complete = false;
        naturalWidth = 0;
        src = '';
        constructor() {
          ControlledImage.last = this;
        }
        finishLoading() {
          this.complete = true;
          this.naturalWidth = 1000;
          this.onload?.();
        }
      }

      const withBrowserImage = async (run: () => Promise<void>) => {
        const originalImage = globalThis.Image;
        const uaSpy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/140');
        globalThis.Image = ControlledImage as unknown as typeof Image;
        try {
          await run();
        } finally {
          globalThis.Image = originalImage;
          uaSpy.mockRestore();
          ControlledImage.last = null;
        }
      };

      it('does not draw until the image has loaded', async () => {
        await withBrowserImage(async () => {
          const originalCreateElement = document.createElement.bind(document);
          let createdCanvas: HTMLCanvasElement | null = null;
          const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            const element = originalCreateElement(tagName);
            if (tagName === 'canvas') createdCanvas = element as HTMLCanvasElement;
            return element;
          });
          try {
            let settled = false;
            const pending = rasterizeSvgToCanvas('<svg xmlns="http://www.w3.org/2000/svg"/>', 400, 400).finally(() => {
              settled = true;
            });
            const image = ControlledImage.last;
            expect(image?.src).toMatch(/^blob:/);
            expect(createdCanvas).not.toBeNull();
            const drawImage = vi.mocked(createdCanvas!.getContext('2d')!.drawImage);

            // Give any stray timers (the old 50 ms fallback) a chance to run before load completes.
            await new Promise(r => setTimeout(r, 80));
            expect(drawImage).not.toHaveBeenCalled();
            expect(settled).toBe(false);

            image?.finishLoading();
            const canvas = await pending;
            expect(canvas).toBe(createdCanvas);
            expect(drawImage).toHaveBeenCalledTimes(1);
            expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 400, 400);
          } finally {
            createSpy.mockRestore();
          }
        });
      });

      it('rejects when the image fails to load', async () => {
        await withBrowserImage(async () => {
          const pending = rasterizeSvgToCanvas('<svg xmlns="http://www.w3.org/2000/svg"/>', 100, 100);
          ControlledImage.last?.onerror?.(new Event('error'));
          await expect(pending).rejects.toThrow('Failed to load SVG image for rasterization');
        });
      });

      it('rejects instead of hanging when the image never settles', async () => {
        await withBrowserImage(async () => {
          vi.useFakeTimers();
          try {
            const pending = rasterizeSvgToCanvas('<svg xmlns="http://www.w3.org/2000/svg"/>', 100, 100);
            const assertion = expect(pending).rejects.toThrow('Timed out waiting for SVG image to load');
            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
          } finally {
            vi.useRealTimers();
          }
        });
      });
    });

    it('validateSvgScannability passes when offscreen raster decodes successfully', async () => {
      const mockScannabilityChecker = await import('@/packages/scannability/checker');
      const spy = vi.spyOn(mockScannabilityChecker, 'performScannabilityCheck').mockReturnValueOnce({
        success: true,
        physicalReady: true,
      });

      const svgString = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const isScannable = await validateSvgScannability(svgString, DEFAULT_CONFIG as QRConfig);
      expect(isScannable).toBe(true);
      expect(spy).toHaveBeenCalled();
    });

    it('validateSvgScannability bypasses scannability check for non-NONE template style', async () => {
      const config = {
        ...(DEFAULT_CONFIG as QRConfig),
        templateStyle: TemplateStyle.SOLID_FRAME,
      };
      const svgString = await generateQRSvg(config);
      const isScannable = await validateSvgScannability(svgString, config);
      expect(isScannable).toBe(true);
    });

    it('validateSvgScannability returns false when pixel scannability check fails', async () => {
      const mockScannabilityChecker = await import('@/packages/scannability/checker');
      const spy = vi.spyOn(mockScannabilityChecker, 'performScannabilityCheck').mockReturnValueOnce({
        success: false,
        physicalReady: false,
        error: 'NOT_FOUND',
      });

      const svgString = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const isScannable = await validateSvgScannability(svgString, DEFAULT_CONFIG as QRConfig);
      expect(isScannable).toBe(false);
      expect(spy).toHaveBeenCalled();
    });

    it('validateSvgScannability returns true when allowUnsafe is true even if pixel scannability check fails', async () => {
      const mockScannabilityChecker = await import('@/packages/scannability/checker');
      const spy = vi.spyOn(mockScannabilityChecker, 'performScannabilityCheck').mockClear();

      const svgString = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const isScannable = await validateSvgScannability(svgString, DEFAULT_CONFIG as QRConfig, { allowUnsafe: true });
      expect(isScannable).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('validateSvgScannability returns false when allowUnsafe is false and pixel scannability check fails', async () => {
      const mockScannabilityChecker = await import('@/packages/scannability/checker');
      const spy = vi.spyOn(mockScannabilityChecker, 'performScannabilityCheck').mockClear().mockReturnValueOnce({
        success: false,
        physicalReady: false,
        error: 'NOT_FOUND',
      });

      const svgString = await generateQRSvg(DEFAULT_CONFIG as QRConfig);
      const isScannable = await validateSvgScannability(svgString, DEFAULT_CONFIG as QRConfig, { allowUnsafe: false });
      expect(isScannable).toBe(false);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('transparent background SVG export', () => {
    it('omits background fill elements when bgColor is transparent for TemplateStyle.NONE', async () => {
      const config: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        bgColor: 'transparent',
        templateStyle: TemplateStyle.NONE,
      };
      const svg = await generateQRSvg(config);
      parseAndAssertValidSvg(svg);
      // Full canvas background rect "M 0 0 L 1080 0 L 1080 1080 L 0 1080 Z" should not be rendered
      expect(svg).not.toContain('d="M 0 0 L 1080 0 L 1080 1080 L 0 1080 Z"');
    });
  });
});
