import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDomainForPath, getSanitizedPath, resolvePublicUrl, resolveImageUrl, formatPathName, compileBreadcrumbSchema } from './metadataEngine';
import { getPublicDomain } from '@/packages/core/site';

describe('metadataEngine', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('getPublicDomain', () => {
    it('returns default domain when VITE_DOMAIN is not set', () => {
      vi.stubEnv('VITE_DOMAIN', '');
      expect(getPublicDomain()).toBe('https://qrcraftly.com');
    });

    it('returns configured VITE_DOMAIN with trailing slashes stripped', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://test.qrcraftly.com///');
      expect(getPublicDomain()).toBe('https://test.qrcraftly.com');
    });

  });

  describe('resolveDomainForPath', () => {
    it('returns default domain when no path is provided', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveDomainForPath('')).toBe('https://qrcraftly.com');
    });

    it('adds leading slash if path does not have one', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveDomainForPath('_subdomain/foo')).toBe('https://foo.qrcraftly.com');
    });

    it('resolves standard path to public domain', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveDomainForPath('/about')).toBe('https://qrcraftly.com');
    });

    it('resolves subdomain path to a subdomain of public domain', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveDomainForPath('/_subdomain/tenant1/about')).toBe('https://tenant1.qrcraftly.com');
    });

    it('falls back to public domain when URL construction fails due to malformed domain', () => {
      vi.stubEnv('VITE_DOMAIN', 'invalid-domain-no-protocol');
      // This will make new URL(domain) throw, triggering catch block
      expect(resolveDomainForPath('/_subdomain/tenant1')).toBe('invalid-domain-no-protocol');
    });
  });

  describe('getSanitizedPath', () => {
    it('returns / if path is empty/falsy', () => {
      expect(getSanitizedPath('')).toBe('/');
    });

    it('adds leading slash if path does not have one', () => {
      expect(getSanitizedPath('about')).toBe('/about');
    });

    it('sanitizes subdomain prefixes', () => {
      expect(getSanitizedPath('/_subdomain/tenant1/about')).toBe('/about');
    });

    it('returns / if subdomain path has no remainder', () => {
      expect(getSanitizedPath('/_subdomain/tenant1')).toBe('/');
    });

    it('returns / if path starts with /_subdomain but does not match pattern', () => {
      expect(getSanitizedPath('/_subdomain')).toBe('/');
    });
  });

  describe('resolvePublicUrl', () => {
    it('compiles public url correctly', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/about')).toBe('https://qrcraftly.com/about');
    });

    it('compiles root path without trailing slash', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/')).toBe('https://qrcraftly.com');
    });

    it('compiles and strips trailing slash from other paths', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/about/')).toBe('https://qrcraftly.com/about');
    });

    it('compiles subdomain paths correctly', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/_subdomain/tenant/dashboard/')).toBe('https://tenant.qrcraftly.com/dashboard');
    });

    it('normalizes multiple consecutive trailing slashes down to a single clean path', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/about//')).toBe('https://qrcraftly.com/about');
      expect(resolvePublicUrl('/about///')).toBe('https://qrcraftly.com/about');
      expect(resolvePublicUrl('/nested/path//')).toBe('https://qrcraftly.com/nested/path');
    });

    it('keeps root path intact and does not strip to empty string', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(getSanitizedPath('//')).toBe('/');
      expect(getSanitizedPath('///')).toBe('/');
      expect(resolvePublicUrl('//')).toBe('https://qrcraftly.com');
      expect(resolvePublicUrl('///')).toBe('https://qrcraftly.com');
    });

    it('works cleanly across different tenant subdomains with consecutive slashes', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/_subdomain/tenant/dashboard//')).toBe('https://tenant.qrcraftly.com/dashboard');
    });

    it('guarantees that path sanitization never alters query parameters, query keys, or URL hash fragments', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolvePublicUrl('/about//?ref=sh')).toBe('https://qrcraftly.com/about?ref=sh');
      expect(resolvePublicUrl('/about//#hash-fragment')).toBe('https://qrcraftly.com/about#hash-fragment');
      expect(resolvePublicUrl('/about//?ref=sh#hash-fragment')).toBe('https://qrcraftly.com/about?ref=sh#hash-fragment');
    });
  });

  describe('resolveImageUrl', () => {
    it('returns default og-image when config is empty', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl(undefined, '/about')).toBe('https://qrcraftly.com/og-image.png');
    });

    it('returns absolute imageUrl if config starts with http', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl('https://externalsite.com/img.png', '/about')).toBe('https://externalsite.com/img.png');
    });

    it('returns prefixed domain image if config starts with slash', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl('/custom-og.png', '/about')).toBe('https://qrcraftly.com/custom-og.png');
    });

    it('returns prefixed domain image if config is relative path without slash', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl('custom-og.png', '/about')).toBe('https://qrcraftly.com/custom-og.png');
    });

    it('forces subdomain page path metadata to resolve static Open Graph assets from the root public domain', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl(undefined, '/_subdomain/tenant1/about')).toBe('https://qrcraftly.com/og-image.png');
      expect(resolveImageUrl('/custom-og.png', '/_subdomain/tenant1/about')).toBe('https://qrcraftly.com/custom-og.png');
      expect(resolveImageUrl('custom-og.png', '/_subdomain/tenant1/about')).toBe('https://qrcraftly.com/custom-og.png');
    });

    it('keeps absolute imageUrl untouched on subdomain page path', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(resolveImageUrl('https://externalsite.com/img.png', '/_subdomain/tenant1/about')).toBe('https://externalsite.com/img.png');
    });
  });

  describe('formatPathName', () => {
    it('applies override for known path segments', () => {
      expect(formatPathName('wifi-qr-code')).toBe('WiFi QR Code');
      expect(formatPathName('about')).toBe('About');
      expect(formatPathName('destroy-the-qr')).toBe('Destroy the QR');
      expect(formatPathName('game')).toBe('QR Damage Simulator Game');
      expect(formatPathName('security')).toBe('Security & Privacy');
    });

    it('capitalizes each word and replaces dashes with spaces for unknown segments', () => {
      expect(formatPathName('special-offer')).toBe('Special Offer');
      expect(formatPathName('nested-path-segment')).toBe('Nested Path Segment');
      expect(formatPathName('sms-qr-code')).toBe('SMS QR Code');
      expect(formatPathName('vcard-qr-code')).toBe('vCard QR Code');
    });
  });

  describe('compileBreadcrumbSchema', () => {
    it('returns null for empty path or null input', () => {
      expect(compileBreadcrumbSchema('')).toBeNull();
    });

    it('returns null for the homepage path (fewer than two items)', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(compileBreadcrumbSchema('/')).toBeNull();
    });

    it('returns null for the homepage path of a subdomain (fewer than two items)', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      expect(compileBreadcrumbSchema('/_subdomain/tenant1')).toBeNull();
    });

    it('returns valid schema for deep paths (two or more items)', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      const schema = compileBreadcrumbSchema('/about');
      expect(schema).not.toBeNull();
      expect(schema['@context']).toBe('https://schema.org');
      expect(schema['@type']).toBe('BreadcrumbList');
      expect(schema.itemListElement).toHaveLength(2);
      expect(schema.itemListElement[0]).toEqual({
        "@type": "ListItem",
        "position": 1,
        "name": "Home",
        "item": "https://qrcraftly.com"
      });
      expect(schema.itemListElement[1]).toEqual({
        "@type": "ListItem",
        "position": 2,
        "name": "About",
        "item": "https://qrcraftly.com/about"
      });
    });

    it('returns valid schema with overridden names and nested paths', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      const schema = compileBreadcrumbSchema('/wifi-qr-code/deep-test');
      expect(schema).not.toBeNull();
      expect(schema.itemListElement).toHaveLength(3);
      expect(schema.itemListElement[1].name).toBe('WiFi QR Code');
      expect(schema.itemListElement[2].name).toBe('Deep Test');
    });

    it('correctly compiles subdomain hosts in breadcrumb list items', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://qrcraftly.com');
      const schema = compileBreadcrumbSchema('/_subdomain/tenant1/about');
      expect(schema).not.toBeNull();
      expect(schema.itemListElement).toHaveLength(2);
      expect(schema.itemListElement[0].item).toBe('https://tenant1.qrcraftly.com');
      expect(schema.itemListElement[1].item).toBe('https://tenant1.qrcraftly.com/about');
    });
  });
});
