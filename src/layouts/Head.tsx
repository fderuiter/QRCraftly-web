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

import { usePageContext } from 'vike-react/usePageContext';
import type { PageContextServer } from 'vike/types';
import { JsonLdScript } from '@/components/ui/JsonLdScript';
import { resolveDomainForPath, resolvePublicUrl, resolveImageUrl, compileBreadcrumbSchema, getSanitizedPath, type JsonLdObject } from '@/utils/metadataEngine';
import { getLegacyRedirect, getMetadataForPath } from '@/data/contentRegistry';
import { getPageSchema } from '@/data/pageContent';
import { getShareImageSize } from '@/data/shareImageSize';
import { THEME_INIT_SCRIPT } from '@/utils/theme';

/**
 * Content Security Policy rendered as a meta tag on every page.
 * Kept byte-identical to `BASE_CSP_PATTERN` in `scripts/csp_hash_injector.js`.
 */
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';";

/**
 * HeadDefault Component
 *
 * Renders the default `<head>` meta tags and link elements for the application.
 * This includes the Content Security Policy, canonical/social metadata, favicon,
 * PWA links and global structured data (JSON-LD) for SEO.
 *
 * Text uses the system font stack (Tailwind `font-sans` / `font-mono`), so the head
 * makes no third-party font requests (#970).
 * @returns The fragment containing meta and link tags.
 */
export default function HeadDefault() {
  // vike-react loads the Head setting only on the server (`env: { server: true }`).
  const pageContext = usePageContext() as PageContextServer;
  // Vike-react exposes the resolved config in pageContext.config
  const { config, is404 } = pageContext;

  // Helper to resolve potentially functional config values
  const getString = (val: string | ((pageContext: PageContextServer) => string | null | undefined) | undefined | null, context: PageContextServer, fallback: string): string => {
    if (!val) return fallback;
    const result = typeof val === 'function' ? val(context) : val;
    return result || fallback;
  };

  const pathMetadata = getMetadataForPath(pageContext.urlPathname);

  const title = getString(config?.title ?? undefined, pageContext, pathMetadata.title || "QRCraftly - Free Custom QR Code Generator");
  const description = getString(config?.description ?? undefined, pageContext, pathMetadata.description || "Generate beautiful, custom QR codes for free. No sign-up required.");

  const resolvedDomain = resolveDomainForPath(pageContext.urlPathname);
  // Retired routes redirect elsewhere; their canonical link points at the replacement.
  // encodeURI escapes any character that could break out of the href (CodeQL js/stored-xss);
  // prerendered route paths are plain ASCII slugs, so it leaves real URLs unchanged.
  const canonicalUrl = encodeURI(resolvePublicUrl(getLegacyRedirect(pageContext.urlPathname)?.canonicalPath ?? pageContext.urlPathname));

  // Resolve Open Graph Image
  // Allows pages to override the default OG image via config.image
  const imageConfig = getString(config?.image, pageContext, '') || pathMetadata.image;
  const imageUrl = resolveImageUrl(imageConfig, pageContext.urlPathname);
  const imageSize = getShareImageSize(imageUrl);

  const imageAlt = config?.imageAlt || pathMetadata.imageAlt || "QRCraftly QR Code Example";

  const sanitizedPath = getSanitizedPath(pageContext.urlPathname);
  const isHomepage = sanitizedPath === '/' || sanitizedPath === '';

  const schemaGraph: JsonLdObject[] = [
    {
      "@type": "Organization",
      "@id": `${resolvedDomain}/#organization`,
      "name": "QRCraftly",
      "url": resolvedDomain,
      "logo": `${resolvedDomain}/favicon.png`,
      "description": "Privacy-focused, client-side QR code generator.",
      "slogan": "Free. Secure. Open Source.",
      "foundingDate": "2025",
      "sameAs": [
        "https://github.com/fderuiter/QRCraftly-web"
      ]
    }
  ];

  if (isHomepage) {
    schemaGraph.push({
      "@type": "WebSite",
      "name": "QRCraftly",
      "url": resolvedDomain,
      "description": "Free, secure, and client-side QR code generator with privacy-first architecture.",
      "publisher": {
        "@id": `${resolvedDomain}/#organization`
      }
    });
  }

  if (!is404) {
    const breadcrumbSchema = compileBreadcrumbSchema(pageContext.urlPathname);
    if (breadcrumbSchema && breadcrumbSchema.itemListElement) {
      schemaGraph.push({
        "@type": "BreadcrumbList",
        "itemListElement": breadcrumbSchema.itemListElement
      });
    }
  }

  // The page's own structured data (application, how-to, FAQ or article). It is built here, on
  // the server, so the content modules it reads never ship to the browser (#1058).
  const pageSchema = is404 ? undefined : getPageSchema(pageContext.urlPathname);

  const consolidatedSchema = {
    "@context": "https://schema.org",
    "@graph": schemaGraph
  };

  return (
    <>
      {/*
        Content Security Policy (CSP). Must match BASE_CSP_PATTERN in
        scripts/csp_hash_injector.js, which rewrites it at build time (replacing
        script-src 'unsafe-inline' with per-page SHA-256 hashes).
        - script-src 'unsafe-inline': Required for JSON-LD scripts and Vike hydration in SSG;
          removed by the build-time hash injector.
        - script-src 'wasm-unsafe-eval': Lets the app compile its own self-hosted WebAssembly
          modules, such as the qr-decode reader (ADR 0033, ADR 0036). It allows WebAssembly
          compilation only, never JavaScript eval.
        - style-src 'unsafe-inline': Still required for React inline style attributes
          (dynamic preview styles). No third-party style hosts.
        - font-src 'self': No web-font CDN; the app renders with the system font stack.
        - img-src/media-src blob:: SVG export rasterizes a blob: object URL, the logo
          resize fallback decodes blob: uploads and video-file scanning plays blob: media.
        - object-src 'none': Prevents Flash/Java applets.
      */}
      <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />

      {/*
        Theme initialisation runs before first paint so a stored or system dark theme never
        flashes light. scripts/csp_hash_injector.js hashes this inline script into script-src.
      */}
      {/* The script is a static module constant (no user input), so injecting it is safe. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />

      {/*
        Note: 'viewport' and 'description' are handled by Vike/Config to avoid duplicates.
        Build output confirmed Vike injects: <meta name="viewport" content="width=device-width,initial-scale=1">

        The 'title' is also injected by Vike based on +config.ts
      */}

      {/* Global Structured Data */}
      <JsonLdScript data={consolidatedSchema} />
      {pageSchema && <JsonLdScript data={pageSchema} />}

      {/* Canonical URL - Do not render for 404 pages to avoid indexing errors */}
      {!is404 && <link rel="canonical" href={canonicalUrl} />}

      {/* Robots Meta for 404 */}
      {is404 && <meta name="robots" content="noindex, nofollow" />}

      {/* Social Signals (Open Graph) */}
      <meta property="og:site_name" content="QRCraftly" />
      <meta property="og:type" content="website" />
      {!is404 && <meta property="og:url" content={canonicalUrl} />}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:type" content="image/png" />
      {imageSize && <meta property="og:image:width" content={String(imageSize.width)} />}
      {imageSize && <meta property="og:image:height" content={String(imageSize.height)} />}
      <meta property="og:image:alt" content={imageAlt} />

      {/* Social Signals (Twitter) */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />

      {/* Mobile & PWA */}
      <meta name="theme-color" content="#0f766e" />
      <link rel="manifest" href="/manifest.json" />
      <link rel="icon" type="image/png" href="/favicon.png" />
      <link rel="apple-touch-icon" href="/icon-192x192.png" />
    </>
  );
}
