import { getConfiguredPublicDomain } from './publicEnvironment';

/** A value inside a schema.org JSON-LD document (`undefined` members are dropped when serialised). */
export type JsonLdValue = string | number | boolean | null | undefined | JsonLdObject | JsonLdValue[];

/** A schema.org JSON-LD node such as `{ "@type": "HowTo", ... }`. */
export interface JsonLdObject {
  [key: string]: JsonLdValue;
}

export const getPublicDomain = (): string => {
  return getConfiguredPublicDomain().replace(/\/+$/, '');
};

/**
 * Upper bound on each memoization cache. Paths come from request URLs, so an
 * unbounded cache would let random paths grow long-lived runtime memory.
 */
export const METADATA_CACHE_LIMIT = 512;

const sanitizedPathCache = new Map<string, string>();
const domainForPathCache = new Map<string, string>();
const publicUrlCache = new Map<string, string>();

/**
 * Stores a memoized value, evicting the oldest entry once the cache is full.
 * @param cache - Target cache.
 * @param key - Cache key.
 * @param value - Value to store.
 */
const remember = (cache: Map<string, string>, key: string, value: string): void => {
  if (!cache.has(key) && cache.size >= METADATA_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
};

/**
 * Current sizes of the memoization caches (for bound assertions).
 * @returns Entry counts per cache.
 */
export const getMetadataCacheSizes = (): { sanitizedPath: number; domainForPath: number; publicUrl: number } => ({
  sanitizedPath: sanitizedPathCache.size,
  domainForPath: domainForPathCache.size,
  publicUrl: publicUrlCache.size,
});

export const resolveDomainForPath = (path: string): string => {
  const domain = getPublicDomain();
  const cacheKey = `${domain}::${path}`;
  if (domainForPathCache.has(cacheKey)) {
    return domainForPathCache.get(cacheKey)!;
  }

  if (!path) {
    remember(domainForPathCache, cacheKey, domain);
    return domain;
  }
  
  let cleanPath = path;
  if (!cleanPath.startsWith('/')) {
    cleanPath = '/' + cleanPath;
  }
  
  const subdomainMatch = cleanPath.match(/^\/_subdomain\/([^\/]+)/);
  if (subdomainMatch) {
    const subdomain = subdomainMatch[1];
    try {
      const url = new URL(domain);
      url.hostname = `${subdomain}.${url.hostname}`;
      const result = `${url.protocol}//${url.host}`;
      remember(domainForPathCache, cacheKey, result);
      return result;
    } catch (_e) {
      // Fallback
    }
  }
  remember(domainForPathCache, cacheKey, domain);
  return domain;
};

const normalizeTrailingSlashes = (path: string): string => {
  if (!path) return '/';
  
  const qMarkIndex = path.indexOf('?');
  const hashIndex = path.indexOf('#');
  
  let endOfPathIndex = path.length;
  if (qMarkIndex !== -1 && hashIndex !== -1) {
    endOfPathIndex = Math.min(qMarkIndex, hashIndex);
  } else if (qMarkIndex !== -1) {
    endOfPathIndex = qMarkIndex;
  } else if (hashIndex !== -1) {
    endOfPathIndex = hashIndex;
  }
  
  let pathPart = path.slice(0, endOfPathIndex);
  const remainder = path.slice(endOfPathIndex);

  // Replace consecutive trailing slashes with a single slash
  pathPart = pathPart.replace(/\/+$/, '/');

  // Strip trailing slash only if it is not the root path "/"
  if (pathPart !== '/' && pathPart.endsWith('/')) {
    pathPart = pathPart.slice(0, -1);
  }

  // Ensure root path remains as "/" and is not stripped to empty string
  if (pathPart === '') {
    pathPart = '/';
  }

  return `${pathPart}${remainder}`;
};

export const getSanitizedPath = (path: string): string => {
  const cacheKey = path || '';
  if (sanitizedPathCache.has(cacheKey)) {
    return sanitizedPathCache.get(cacheKey)!;
  }

  let cleanPath = path || '/';
  if (!cleanPath.startsWith('/')) {
    cleanPath = '/' + cleanPath;
  }
  
  const subdomainMatch = cleanPath.match(/^\/_subdomain\/[^\/]+(.*)$/);
  if (subdomainMatch) {
    cleanPath = subdomainMatch[1] || '/';
  } else if (cleanPath.startsWith('/_subdomain')) {
    cleanPath = '/';
  }
  
  const result = normalizeTrailingSlashes(cleanPath);
  remember(sanitizedPathCache, cacheKey, result);
  return result;
};

export const resolvePublicUrl = (path: string): string => {
  const domain = getPublicDomain();
  const cacheKey = `${domain}::${path}`;
  if (publicUrlCache.has(cacheKey)) {
    return publicUrlCache.get(cacheKey)!;
  }

  const resolvedDomain = resolveDomainForPath(path);
  let cleanPath = getSanitizedPath(path);
  
  if (cleanPath !== '/' && cleanPath.endsWith('/')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  
  const finalPath = cleanPath === '/' ? '' : cleanPath;
  const result = `${resolvedDomain}${finalPath}`;
  remember(publicUrlCache, cacheKey, result);
  return result;
};

export const resolveImageUrl = (imageConfig: string | undefined, _path: string): string => {
  const domain = getPublicDomain();
  let imageUrl = `${domain}/og-image.png`;

  if (imageConfig) {
      if (imageConfig.startsWith('http')) {
          imageUrl = imageConfig;
      } else if (imageConfig.startsWith('/')) {
          imageUrl = `${domain}${imageConfig}`;
      } else {
          imageUrl = `${domain}/${imageConfig}`;
      }
  }
  return imageUrl;
};

export const formatPathName = (segment: string): string => {
  // Dictionary for specific overrides
  const overrides: Record<string, string> = {
    'wifi-qr-code': 'WiFi QR Code',
    'bulk-csv-qr-code': 'Bulk CSV Batch QR Code',
    'about': 'About',
    'destroy-the-qr': 'Destroy the QR',
    'game': 'QR Damage Simulator Game',
    'arcade': 'QR Arcade',
    'security': 'Security & Privacy',
    'free-forever': 'Free Forever',
    'acknowledgements': 'Open-Source Acknowledgements',
    'privacy': 'App Privacy Policy',
    'support': 'App Support',
    'guides': 'Guides',
    'why-qr-codes-stop-working': 'Why QR Codes Stop Working',
    'static-vs-dynamic-qr-codes': 'Static vs Dynamic QR Codes',
    'how-to-print-a-qr-code-that-scans': 'Printing a QR Code That Scans',
    'qr-code-error-correction-explained': 'Error Correction Explained',
    'qr-code-scams-quishing': 'QR Code Scams (Quishing)',
    'qr-code-scanner': 'QR Code Scanner',
    'qr-code-checker': 'QR Code Checker',
    'mosaic-qr-code': 'Image (Mosaic) QR Code',
    'qr-code-with-logo': 'QR Code with Logo',
    'google-review-qr-code': 'Google Review QR Code',
    'menu-qr-code': 'Menu QR Code',
    'instagram-qr-code': 'Instagram QR Code',
    'whatsapp-qr-code': 'WhatsApp QR Code',
    'pdf-qr-code': 'PDF QR Code',
  };

  if (overrides[segment]) {
    return overrides[segment];
  }

  // Default: Capitalize each word (replace dashes with spaces)
  return segment
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// The result is free-form JSON-LD that callers index into loosely (see metadataEngine.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const compileBreadcrumbSchema = (path: string): any => {
  if (!path) return null;

  // Determine the base path to correctly resolve the home URL for domains and subdomains
  const subdomainMatch = path.match(/^\/_subdomain\/[^\/]+/);
  const basePath = subdomainMatch ? subdomainMatch[0] : '/';

  const resolvedDomain = resolveDomainForPath(path);

  const breadcrumbItems: JsonLdObject[] = [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": resolvePublicUrl(basePath)
    }
  ];

  // Dynamically generate breadcrumbs from path
  const sanitizedPath = getSanitizedPath(path);
  const pathSegments = sanitizedPath.split('/').filter(Boolean);
  let currentPath = '';

  pathSegments.forEach((segment: string, index: number) => {
    currentPath += `/${segment}`;
    breadcrumbItems.push({
      "@type": "ListItem",
      "position": index + 2, // 1 is Home, so start at 2
      "name": formatPathName(segment),
      "item": `${resolvedDomain}${currentPath}`
    });
  });

  if (breadcrumbItems.length < 2) {
    return null;
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbItems
  };
};
