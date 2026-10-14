import { describe, it, expect } from 'vitest';
import { looksLikeWebAddress, normalizeUrl, SafeUrlPipeline } from './url';

describe('SafeUrlPipeline', () => {
  describe('decodeHtmlEntities', () => {
    it('decodes hex entities', () => {
      expect(SafeUrlPipeline.decodeHtmlEntities('&#x6a;&#x61;')).toBe('ja');
      expect(SafeUrlPipeline.decodeHtmlEntities('&#X6a;&#X61;')).toBe('ja');
    });

    it('decodes decimal entities', () => {
      expect(SafeUrlPipeline.decodeHtmlEntities('&#106;&#97;')).toBe('ja');
    });

    it('decodes named entities', () => {
      expect(SafeUrlPipeline.decodeHtmlEntities('&colon;&tab;&newline;&quot;&amp;&lt;&gt;')).toBe(':\t\n"&<>');
    });

    it('retains original match for unknown entities', () => {
      expect(SafeUrlPipeline.decodeHtmlEntities('&unknown;')).toBe('&unknown;');
    });
  });

  describe('decodeObfuscation', () => {
    it('decodes URL encoding recursively', () => {
      // %253A -> %3A -> :
      expect(SafeUrlPipeline.decodeObfuscation('%253A')).toBe(':');
    });

    it('respects maximum depth of 10 to avoid infinite loops', () => {
      // 12 nested URL encodings of ':'
      // %25252525252525252525253A
      const nested = '%25%25%25%25%25%25%25%25%25%25%253A';
      const decoded = SafeUrlPipeline.decodeObfuscation(nested);
      expect(decoded).toBeDefined();
    });

    it('ignores malformed decodeURIComponent failures gracefully', () => {
      expect(SafeUrlPipeline.decodeObfuscation('%E0%A4')).toBe('%E0%A4');
    });
  });

  describe('isDangerous', () => {
    it('returns false for undefined or empty url', () => {
      expect(SafeUrlPipeline.isDangerous(undefined)).toBe(false);
      expect(SafeUrlPipeline.isDangerous('')).toBe(false);
    });

    it('returns true for dangerous protocols', () => {
      expect(SafeUrlPipeline.isDangerous('javascript:alert(1)')).toBe(true);
      expect(SafeUrlPipeline.isDangerous('vbscript:msgbox')).toBe(true);
      expect(SafeUrlPipeline.isDangerous('data:text/html,evil')).toBe(true);
      expect(SafeUrlPipeline.isDangerous('file:///etc/passwd')).toBe(true);
    });

    it('returns true for obfuscated or spaced dangerous protocols', () => {
      expect(SafeUrlPipeline.isDangerous('java\tscript:alert(1)')).toBe(true);
      expect(SafeUrlPipeline.isDangerous('&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)')).toBe(true);
    });

    it('returns false for safe protocols', () => {
      expect(SafeUrlPipeline.isDangerous('https://google.com')).toBe(false);
      expect(SafeUrlPipeline.isDangerous('mailto:test@example.com')).toBe(false);
    });
  });

  describe('normalize', () => {
    it('strips control characters', () => {
      const urlWithControl = 'https://google.com/\u0000\u001Ftest';
      expect(SafeUrlPipeline.normalize(urlWithControl)).toBe('https://google.com/test');
    });

    it('handles root or relative query fallback path', () => {
      expect(SafeUrlPipeline.normalize('/path')).toBe('/path');
      expect(SafeUrlPipeline.normalize('?query')).toBe('?query');
    });
  });
});

describe('normalizeUrl', () => {
  it('should return empty string for undefined input', () => {
    expect(normalizeUrl(undefined)).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
  });

  it('should preserve valid absolute URLs (http)', () => {
    const url = 'http://example.com';
    expect(normalizeUrl(url)).toBe('http://example.com/');
  });

  it('should preserve valid absolute URLs (https)', () => {
    const url = 'https://example.com/foo';
    expect(normalizeUrl(url)).toBe('https://example.com/foo');
  });

  it('should add https:// to URLs without protocol', () => {
    const url = 'example.com';
    expect(normalizeUrl(url)).toBe('https://example.com/');
  });

  it('should add https:// to URLs starting with www', () => {
    const url = 'www.google.com';
    expect(normalizeUrl(url)).toBe('https://www.google.com/');
  });

  it('should encode spaces in URLs without protocol', () => {
    // "example.com/foo bar" -> https://example.com/foo%20bar
    const url = 'example.com/foo bar';
    expect(normalizeUrl(url)).toBe('https://example.com/foo%20bar');
  });

  it('should fallback to encodeURI for malformed URLs that cannot be parsed as URL', () => {
    // "not a url" -> "not%20a%20url" (fallback 3)
    expect(normalizeUrl('not a url')).toBe('not%20a%20url');
  });

  it('should handle complex URLs with query params containing spaces', () => {
     const url = 'https://example.com/search?q=hello world';
     expect(normalizeUrl(url)).toBe('https://example.com/search?q=hello%20world');
  });

  it('should handle URLs with existing encoded characters', () => {
      const url = 'http://example.com/foo%20bar';
      expect(normalizeUrl(url)).toBe('http://example.com/foo%20bar');
  });

  it('should return original string when all parsing/encoding fails (e.g. lone surrogates)', () => {
    // Lone surrogate \uD800 causes encodeURI to throw
    const invalid = '\uD800';
    expect(normalizeUrl(invalid)).toBe(invalid);
  });
});

describe('looksLikeWebAddress', () => {
  it('accepts addresses a phone can open', () => {
    for (const value of ['', 'example.com', 'https://example.com/a%20b', 'www.example.co.uk/menu?x=1', 'localhost:3000', 'http://192.168.1.10/', 'mailto:a@b.example']) {
      expect(looksLikeWebAddress(value)).toBe(true);
    }
  });

  it('rejects text with no host, spaces in the host or no dot', () => {
    for (const value of ['not a url', 'https://not%20a%20url/', 'mysite', 'https://intranet/']) {
      expect(looksLikeWebAddress(value)).toBe(false);
    }
  });
});
