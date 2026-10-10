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

import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import HeadDefault from './Head';
import { THEME_INIT_SCRIPT } from '@/utils/theme';
import { getPageSchema } from '@/data/pageContent';

// Hoist the mock functions so they can be used inside vi.mock
const { mockUsePageContext, mockGetPublicDomain } = vi.hoisted(() => {
  return {
    mockUsePageContext: vi.fn(),
    mockGetPublicDomain: vi.fn(() => 'https://qrcraftly.com')
  };
});

// Mock usePageContext
vi.mock('vike-react/usePageContext', () => ({
  usePageContext: mockUsePageContext
}));

// Mock getPublicDomain
vi.mock('@/utils/metadataEngine', async () => {
  const actual = await vi.importActual('@/utils/metadataEngine');
  return {
    ...actual,
    getPublicDomain: mockGetPublicDomain
  };
});

describe('HeadDefault', () => {
  // Default mock implementation
  beforeEach(() => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/',
      config: {
        title: 'Test Title',
        description: 'Test Desc'
      }
    });
    // Clear head
    document.head.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.head.innerHTML = '';
    vi.clearAllMocks();
  });

  it('includes a Content Security Policy (CSP) meta tag', () => {
    const { container } = render(<HeadDefault />, { container: document.head });

    const metaCSP = container.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(metaCSP).toBeInTheDocument();

    const content = metaCSP?.getAttribute('content') || '';
    expect(content).toContain("default-src 'self'");
  });

  it('renders the pre-hydration theme script after the CSP meta tag', () => {
    render(<HeadDefault />, { container: document.head });
    const children = Array.from(document.head.children);
    const cspIndex = children.findIndex((el) => el.getAttribute('http-equiv') === 'Content-Security-Policy');
    const themeIndex = children.findIndex((el) => el.tagName === 'SCRIPT' && el.textContent === THEME_INIT_SCRIPT);
    expect(themeIndex).toBeGreaterThan(cspIndex);
    expect(children[themeIndex]).not.toHaveAttribute('type');
  });

  describe('Content Security Policy directives', () => {
    const renderCspDirectives = (): Map<string, string[]> => {
      const { container } = render(<HeadDefault />, { container: document.head });
      const content = container.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
      const directives = new Map<string, string[]>();
      for (const directive of content.split(';').map(d => d.trim()).filter(Boolean)) {
        const [name, ...sources] = directive.split(/\s+/);
        directives.set(name, sources);
      }
      return directives;
    };

    it('allows blob: images so SVG export can rasterize its object URL (#969)', () => {
      expect(renderCspDirectives().get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    });

    it('allows blob: media so uploaded video files can be scanned (#969)', () => {
      expect(renderCspDirectives().get('media-src')).toEqual(["'self'", 'blob:']);
    });

    it('allows no third-party font or style hosts (#970)', () => {
      const directives = renderCspDirectives();
      expect(directives.get('font-src')).toEqual(["'self'"]);
      expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
      const allSources = Array.from(directives.values()).flat();
      expect(allSources.filter(source => /^https?:/.test(source))).toEqual([]);
    });
  });

  it('makes no Google Fonts requests and emits no third-party preconnect hints (#970)', () => {
    render(<HeadDefault />, { container: document.head });

    const externalLinks = Array.from(document.head.querySelectorAll('link')).filter(link => {
      const href = link.getAttribute('href') ?? '';
      return /^https?:\/\//.test(href) && link.getAttribute('rel') !== 'canonical';
    });
    expect(externalLinks).toEqual([]);
    expect(document.head.innerHTML).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('includes complete global organization schema metadata', () => {
    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    const orgScript = Array.from(scripts).find(s => s.textContent?.includes('Organization'));
    expect(orgScript).toBeDefined();

    const data = JSON.parse(orgScript!.textContent!);
    expect(data['@context']).toBe('https://schema.org');
    
    const org = data['@graph'].find((item: any) => item['@type'] === 'Organization');
    expect(org).toBeDefined();
    expect(org['@id']).toBe('https://qrcraftly.com/#organization');
    expect(org.name).toBe('QRCraftly');
    expect(org.description).toBe('Privacy-focused, client-side QR code generator.');
    expect(org.slogan).toBe('Free. Secure. Open Source.');
    expect(org.foundingDate).toBe('2025');
  });

  it('declares the real size of a generated share image', () => {
    const { container } = render(<HeadDefault />, { container: document.head });

    expect(container.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://qrcraftly.com/og/index.png');
    expect(container.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(container.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
  });

  it('declares the fallback image size on pages without their own share image', () => {
    mockUsePageContext.mockReturnValue({ urlPathname: '/404', is404: true, config: { image: '/og-image.png' } });
    const { container } = render(<HeadDefault />, { container: document.head });

    expect(container.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1280');
    expect(container.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('720');
  });

  it('does not render breadcrumbs for the home page root path', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(2);

    const rootData = JSON.parse(scripts[0].textContent!);
    const breadcrumbNode = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(breadcrumbNode).toBeUndefined();
  });

  it('generates correct breadcrumbs for About page', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/about',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    const script = Array.from(scripts).find(s => s.textContent?.includes('BreadcrumbList'));
    expect(script).toBeDefined();

    const rootData = JSON.parse(script!.textContent!);
    const data = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(data).toBeDefined();

    const expectedDomain = mockGetPublicDomain();
    expect(data.itemListElement).toHaveLength(2);
    expect(data.itemListElement[1].name).toBe('About');
    expect(data.itemListElement[1].item).toBe(`${expectedDomain}/about`);
  });

  it('generates correct breadcrumbs for WiFi QR Code page (with override)', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/wifi-qr-code',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    const script = Array.from(scripts).find(s => s.textContent?.includes('BreadcrumbList'));
    expect(script).toBeDefined();

    const rootData = JSON.parse(script!.textContent!);
    const data = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(data).toBeDefined();

    const expectedDomain = mockGetPublicDomain();
    expect(data.itemListElement).toHaveLength(2);
    expect(data.itemListElement[1].name).toBe('WiFi QR Code'); // Verify override works
    expect(data.itemListElement[1].item).toBe(`${expectedDomain}/wifi-qr-code`);
  });

  it('generates correct breadcrumbs for nested/unknown paths (dynamic formatting)', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/products/special-offer',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    const script = Array.from(scripts).find(s => s.textContent?.includes('BreadcrumbList'));
    expect(script).toBeDefined();

    const rootData = JSON.parse(script!.textContent!);
    const data = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(data).toBeDefined();

    const expectedDomain = mockGetPublicDomain();
    expect(data.itemListElement).toHaveLength(3);

    // Level 1: Products
    expect(data.itemListElement[1].position).toBe(2);
    expect(data.itemListElement[1].name).toBe('Products');
    expect(data.itemListElement[1].item).toBe(`${expectedDomain}/products`);

    // Level 2: Special Offer
    expect(data.itemListElement[2].position).toBe(3);
    expect(data.itemListElement[2].name).toBe('Special Offer'); // Verify capitalization and dash replacement
    expect(data.itemListElement[2].item).toBe(`${expectedDomain}/products/special-offer`);
  });

  it('percent-encodes characters in the canonical URL so they cannot break out of the href', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/about"><script>x</script>',
      is404: false,
      config: {}
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    const href = container.querySelector('link[rel="canonical"]')?.getAttribute('href');
    expect(href).toBe('https://qrcraftly.com/about%22%3E%3Cscript%3Ex%3C/script%3E');
    expect(container.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(href);
  });

  it('handles 404 pages correctly (noindex, no canonical, no og:url)', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/some-garbage-url',
      is404: true,
      config: {}
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    // Check for noindex meta tag
    const metaRobots = container.querySelector('meta[name="robots"]');
    expect(metaRobots).toBeInTheDocument();
    expect(metaRobots?.getAttribute('content')).toBe('noindex, nofollow');

    // Check that canonical link is NOT present
    const canonical = container.querySelector('link[rel="canonical"]');
    expect(canonical).not.toBeInTheDocument();

    // Check that og:url is NOT present
    const ogUrl = container.querySelector('meta[property="og:url"]');
    expect(ogUrl).not.toBeInTheDocument();

    // Check that basic Open Graph brand metadata tags are still present
    const ogSiteName = container.querySelector('meta[property="og:site_name"]');
    expect(ogSiteName).toBeInTheDocument();
    expect(ogSiteName?.getAttribute('content')).toBe('QRCraftly');

    const ogType = container.querySelector('meta[property="og:type"]');
    expect(ogType).toBeInTheDocument();
    expect(ogType?.getAttribute('content')).toBe('website');

    // Check that breadcrumb schema is NOT generated for the garbage path
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    const rootData = JSON.parse(scripts[0].textContent!);
    const breadcrumbNode = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(breadcrumbNode).toBeUndefined();
  });

  it('excludes the WebSite schema node on non-root pages', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/about',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(2);

    const rootData = JSON.parse(scripts[0].textContent!);
    const websiteNode = rootData['@graph'].find((item: any) => item['@type'] === 'WebSite');
    expect(websiteNode).toBeUndefined();

    const orgNode = rootData['@graph'].find((item: any) => item['@type'] === 'Organization');
    expect(orgNode).toBeDefined();
  });

  it('includes Organization and WebSite, but suppresses BreadcrumbList, on the homepage', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/',
      config: {}
    });

    render(<HeadDefault />, { container: document.head });

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(2);

    const rootData = JSON.parse(scripts[0].textContent!);
    const orgNode = rootData['@graph'].find((item: any) => item['@type'] === 'Organization');
    const websiteNode = rootData['@graph'].find((item: any) => item['@type'] === 'WebSite');
    const breadcrumbNode = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');

    expect(orgNode).toBeDefined();
    expect(websiteNode).toBeDefined();
    expect(breadcrumbNode).toBeUndefined();
  });

  it('renders og:url on normal pages with the fully resolved public URL', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/normal-page-path',
      config: {}
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    const expectedDomain = mockGetPublicDomain();
    const ogUrl = container.querySelector('meta[property="og:url"]');
    expect(ogUrl).toBeInTheDocument();
    expect(ogUrl?.getAttribute('content')).toBe(`${expectedDomain}/normal-page-path`);
  });

  it('uses custom Open Graph image from config', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/custom-image-page',
      config: {
        image: '/custom-og-image.png',
        imageAlt: 'Custom OG Image Alt Text'
      }
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    const expectedDomain = mockGetPublicDomain();
    // Check og:image
    const ogImage = container.querySelector('meta[property="og:image"]');
    expect(ogImage).toBeInTheDocument();
    expect(ogImage?.getAttribute('content')).toBe(`${expectedDomain}/custom-og-image.png`);

    // Check og:image:alt
    const ogImageAlt = container.querySelector('meta[property="og:image:alt"]');
    expect(ogImageAlt).toBeInTheDocument();
    expect(ogImageAlt?.getAttribute('content')).toBe('Custom OG Image Alt Text');

    // Check twitter:image
    const twitterImage = container.querySelector('meta[name="twitter:image"]');
    expect(twitterImage).toBeInTheDocument();
    expect(twitterImage?.getAttribute('content')).toBe(`${expectedDomain}/custom-og-image.png`);

    // Check twitter:image:alt
    const twitterImageAlt = container.querySelector('meta[name="twitter:image:alt"]');
    expect(twitterImageAlt).toBeInTheDocument();
    expect(twitterImageAlt?.getAttribute('content')).toBe('Custom OG Image Alt Text');
  });

  it('falls back to default Open Graph image if config is missing', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/default-image-page',
      config: {}
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    const expectedDomain = mockGetPublicDomain();
    // Check og:image
    const ogImage = container.querySelector('meta[property="og:image"]');
    expect(ogImage).toBeInTheDocument();
    expect(ogImage?.getAttribute('content')).toBe(`${expectedDomain}/og-image.png`);

    // Check og:image:alt
    const ogImageAlt = container.querySelector('meta[property="og:image:alt"]');
    expect(ogImageAlt).toBeInTheDocument();
    expect(ogImageAlt?.getAttribute('content')).toBe('QRCraftly QR Code Example');
  });

  it('correctly resolves subdomains from the _subdomain/ path prefix', () => {
    mockUsePageContext.mockReturnValue({
      urlPathname: '/_subdomain/tenant1/about',
      config: {}
    });

    const { container } = render(<HeadDefault />, { container: document.head });

    const baseDomain = mockGetPublicDomain();
    const expectedDomain = `https://tenant1.${new URL(baseDomain).hostname}`;

    const canonical = container.querySelector('link[rel="canonical"]');
    expect(canonical).toBeInTheDocument();
    expect(canonical?.getAttribute('href')).toBe(`${expectedDomain}/about`);

    const ogUrl = container.querySelector('meta[property="og:url"]');
    expect(ogUrl?.getAttribute('content')).toBe(`${expectedDomain}/about`);

    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    const script = Array.from(scripts).find(s => s.textContent?.includes('BreadcrumbList'));
    expect(script).toBeDefined();

    const rootData = JSON.parse(script!.textContent!);
    const data = rootData['@graph'].find((item: any) => item['@type'] === 'BreadcrumbList');
    expect(data).toBeDefined();

    expect(data.itemListElement).toHaveLength(2);
    expect(data.itemListElement[0].item).toBe(expectedDomain);
    expect(data.itemListElement[1].name).toBe('About');
    expect(data.itemListElement[1].item).toBe(`${expectedDomain}/about`);
  });

  it("renders the page's own structured data after the site graph (#1058)", () => {
    mockUsePageContext.mockReturnValue({ urlPathname: '/wifi-qr-code', config: {} });
    render(<HeadDefault />, { container: document.head });
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(2);
    expect(JSON.parse(scripts[1].textContent!)).toEqual(getPageSchema('/wifi-qr-code'));
  });

  it('renders only the site graph for a page without its own structured data', () => {
    mockUsePageContext.mockReturnValue({ urlPathname: '/privacy', config: {} });
    render(<HeadDefault />, { container: document.head });
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
  });
});
