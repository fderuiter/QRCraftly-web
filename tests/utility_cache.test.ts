import { describe, it, expect, vi } from 'vitest';
import { getSanitizedPath, resolveDomainForPath, resolvePublicUrl, getMetadataCacheSizes, METADATA_CACHE_LIMIT } from '../src/utils/metadataEngine';
import { safeJsonLdStringify } from '@/packages/core/security';

describe('Global Pure-JS Utility Caching', () => {
  describe('Metadata and Path Sanitization Cache', () => {
    it('bounds every memoization cache so random request paths cannot grow memory', () => {
      for (let i = 0; i < METADATA_CACHE_LIMIT * 3; i += 1) {
        const path = `/random-${i}-${Math.random().toString(36).slice(2)}`;
        expect(getSanitizedPath(path)).toBe(path);
        resolvePublicUrl(path);
        resolveDomainForPath(path);
      }
      const sizes = getMetadataCacheSizes();
      expect(sizes.sanitizedPath).toBeLessThanOrEqual(METADATA_CACHE_LIMIT);
      expect(sizes.publicUrl).toBeLessThanOrEqual(METADATA_CACHE_LIMIT);
      expect(sizes.domainForPath).toBeLessThanOrEqual(METADATA_CACHE_LIMIT);
    });

    it('caches path sanitization results correctly', () => {
      const path = '/some-path/nested/';
      const result1 = getSanitizedPath(path);
      const result2 = getSanitizedPath(path);
      expect(result1).toBe('/some-path/nested');
      expect(result2).toBe('/some-path/nested');
    });

    it('caches subdomain resolution correctly', () => {
      const path = '/_subdomain/tenant/about';
      const result1 = resolveDomainForPath(path);
      const result2 = resolveDomainForPath(path);
      expect(result1).toBe('https://tenant.qrcraftly.com');
      expect(result2).toBe('https://tenant.qrcraftly.com');
    });

    it('caches public URL resolution correctly', () => {
      const path = '/_subdomain/tenant/about//';
      const result1 = resolvePublicUrl(path);
      const result2 = resolvePublicUrl(path);
      expect(result1).toBe('https://tenant.qrcraftly.com/about');
      expect(result2).toBe('https://tenant.qrcraftly.com/about');
    });

    it('uses public domain configurations dynamically as cache keys to prevent stale test isolation issues', () => {
      vi.stubEnv('VITE_DOMAIN', 'https://domain-one.com');
      const path = '/about';
      const url1 = resolvePublicUrl(path);
      expect(url1).toBe('https://domain-one.com/about');

      vi.stubEnv('VITE_DOMAIN', 'https://domain-two.com');
      const url2 = resolvePublicUrl(path);
      expect(url2).toBe('https://domain-two.com/about');

      vi.unstubAllEnvs();
    });
  });

  describe('JSON-LD Schema Stringification Cache', () => {
    it('caches escaped schema strings to bypass regex replacements', () => {
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': 'QRCraftly',
        'description': 'A beautiful & safe QR generator',
        'potentialAction': {
          '@type': 'SearchAction',
          'target': 'https://qrcraftly.com/search?q={search_term_string}',
          'query-input': 'required name=search_term_string'
        }
      };

      const res1 = safeJsonLdStringify(schema);
      const res2 = safeJsonLdStringify(schema);

      expect(res1).toContain('\\u0026'); // & should be escaped to \u0026
      expect(res2).toContain('\\u0026');
      expect(res1).toBe(res2);
    });

    it('handles object structures with identical content by reusing the cache', () => {
      const schema1 = { '@context': 'https://schema.org', 'test': 'foo' };
      const schema2 = { '@context': 'https://schema.org', 'test': 'foo' };

      const res1 = safeJsonLdStringify(schema1);
      const res2 = safeJsonLdStringify(schema2);

      expect(res1).toBe(res2);
    });
  });
});
