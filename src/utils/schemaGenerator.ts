import type { Guide } from '../data/guides';
import type { ToolCopy } from '../data/copy/types';
import { type SiteVideo, videoSrc } from '../data/videos';
import { type ToolContent, type AuxiliaryContent, getContentForPath, getContentById } from '../data/contentRegistry';
import { resolveDomainForPath, resolvePublicUrl, type JsonLdObject } from './metadataEngine';

/**
 * Absolute URL of a page's share image, on the page's own domain. The registry holds the
 * per-page image written at build time (`/og/<id>.png`).
 * @param image - The registry's image path or URL.
 * @param domain - The page's public domain.
 * @returns The absolute image URL.
 */
function imageUrl(image: string | undefined, domain: string): string {
  if (!image) return `${domain}/og-image.png`;
  if (/^https?:\/\//.test(image)) return image;
  return `${domain}${image.startsWith('/') ? '' : '/'}${image}`;
}

/** Released package version, injected by Vite from package.json. */
const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/**
 * Dynamically generates structured schema.org JSON-LD graph data directly from central content registry.
 * Eliminates static route config import maps.
 *
 * @param contentOrPath The registry content object or route path / tool ID string.
 * @param resolvedDomain Optional domain string override.
 * @param requestPath Optional request path string override.
 * @returns Structured JSON-LD schema graph.
 */
export function generateSchema(
  contentOrPath: ((ToolContent | AuxiliaryContent) & ToolCopy) | string,
  resolvedDomain?: string,
  requestPath?: string
  // Free-form JSON-LD document; callers index into its graph loosely (see schemaGenerator.test.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let content: ((ToolContent | AuxiliaryContent) & ToolCopy) | undefined;

  if (typeof contentOrPath === 'string') {
    content = getContentForPath(contentOrPath) || getContentById(contentOrPath);
  } else {
    content = contentOrPath;
  }

  if (!content) {
    return {
      "@context": "https://schema.org",
      "@graph": []
    };
  }

  const contentUrl = (content as ToolContent).url || (requestPath ? resolvePublicUrl(requestPath) : '');
  const domain = resolvedDomain || resolveDomainForPath(contentUrl || (requestPath ? resolvePublicUrl(requestPath) : ''));
  const publicUrl = requestPath ? resolvePublicUrl(requestPath) : (contentUrl || `${domain}/${content.id}`);


  if (content.id === 'about') {
    const aboutGraph: JsonLdObject[] = [
      {
        "@type": "AboutPage",
        "name": content.name,
        "description": content.description,
        "url": publicUrl,
        "mainEntity": {
          "@id": `${domain}/#organization`
        }
      }
    ];

    aboutGraph.push(...faqGraph(content as ToolContent & ToolCopy));

    return {
      "@context": "https://schema.org",
      "@graph": aboutGraph
    };
  }

  const toolContent = content as ToolContent & ToolCopy;

  // A page about the project (such as the pledge) is not an app: describe it as the page it is.
  if (toolContent.schemaType === "AboutPage") {
    return {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "AboutPage",
          "name": content.name,
          "description": content.description,
          "url": publicUrl,
          "mainEntity": {
            "@id": `${domain}/#organization`
          }
        },
        ...faqGraph(toolContent)
      ]
    };
  }

  const typeValue = toolContent.schemaType || "WebApplication";
  const categoryValue = toolContent.schemaCategory || "UtilitiesApplication";

  // Only the features the page shows; the value-proposition and persona labels are internal. One
  // value per feature, because a feature's own commas would split a joined list in the wrong places.
  const featureList = [...(toolContent.features || [])];

  const appEntity: JsonLdObject = {
    "@type": typeValue,
    "name": content.name,
    "description": content.description,
    "url": publicUrl,
    "applicationCategory": categoryValue,
    "operatingSystem": "All",
    "softwareVersion": APP_VERSION,
    "image": imageUrl(content.image, domain),
    "author": {
      "@id": `${domain}/#organization`
    },
    "browserRequirements": "Requires JavaScript. Works in all modern browsers.",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    },
    "featureList": featureList
  };

  const graph: JsonLdObject[] = [appEntity];

  // Policy (#1619, checked 2026-10-24): Google no longer shows HowTo rich results and shows FAQ
  // rich results only for government and health sites
  // (https://developers.google.com/search/blog/2023/08/howto-faq-changes,
  // https://developers.google.com/search/docs/appearance/structured-data/faqpage), so neither earns
  // a rich result here. Both are kept on purpose: they are valid schema.org that Bing and answer
  // engines still read, they mirror copy the page shows, and Google ignores them without penalty.
  if (toolContent.howTo) {
    const howToObj: JsonLdObject = {
      "@type": "HowTo",
      "name": toolContent.howTo.name,
      "description": toolContent.howTo.description,
      "totalTime": "PT1M",
      "estimatedCost": {
        "@type": "MonetaryAmount",
        "currency": "USD",
        "value": "0"
      },
      "step": toolContent.howTo.steps.map(step => ({
        "@type": "HowToStep",
        "name": step.name,
        "text": step.text
      }))
    };

    if (toolContent.howTo.supply) {
      howToObj.supply = toolContent.howTo.supply.map(s => ({
        "@type": "HowToSupply",
        "name": s.name
      }));
    }

    graph.push(howToObj);
  }

  graph.push(...faqGraph(toolContent));

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

/**
 * The FAQPage entity for a page's questions, or nothing when it has none. Every page that has
 * FAQ copy renders the same questions and answers, so the markup matches what visitors see.
 * @param copy - The page's copy.
 * @returns Zero or one FAQPage entity.
 */
function faqGraph(copy: ToolCopy): JsonLdObject[] {
  if (!copy.faqs || copy.faqs.length === 0) return [];
  return [{
    "@type": "FAQPage",
    "mainEntity": copy.faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  }];
}

/**
 * Builds the Article JSON-LD for one guide, with the QRCraftly organization as author and publisher.
 * @param guide - The guide being rendered.
 * @param domain - Origin the page is served from.
 * @returns A schema.org graph.
 */
export function generateGuideSchema(guide: Guide, domain: string): JsonLdObject {
  const url = resolvePublicUrl(`/guides/${guide.slug}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "headline": guide.title,
        "description": guide.description,
        "url": url,
        "mainEntityOfPage": url,
        "datePublished": guide.datePublished,
        "dateModified": guide.dateModified,
        "inLanguage": "en",
        "author": { "@id": `${domain}/#organization` },
        "publisher": { "@id": `${domain}/#organization` },
        "citation": guide.sources.map(source => source.url)
      }
    ]
  };
}

/**
 * Builds the CollectionPage JSON-LD for the guides index.
 * @param description - Index page description.
 * @param domain - Origin the page is served from.
 * @returns A schema.org graph.
 */
export function generateGuideIndexSchema(description: string, domain: string): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "name": "QR code guides",
        "description": description,
        "url": resolvePublicUrl('/guides'),
        "publisher": { "@id": `${domain}/#organization` }
      }
    ]
  };
}

/**
 * Schema for the `/videos` page: a collection page that lists each video as a VideoObject, so
 * search engines can show the clips in video results.
 * @param description - The page description.
 * @param videos - The videos on the page, in order.
 * @param domain - The site origin, for the publisher reference.
 * @returns The JSON-LD graph.
 */
export function generateVideoPageSchema(description: string, videos: readonly SiteVideo[], domain: string): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "name": "QRCraftly videos",
        "description": description,
        "url": resolvePublicUrl('/videos'),
        "publisher": { "@id": `${domain}/#organization` },
        "hasPart": videos.map((video) => ({
          "@type": "VideoObject",
          "name": video.title,
          "description": video.description,
          "thumbnailUrl": resolvePublicUrl(videoSrc(video, 'jpg')),
          "contentUrl": resolvePublicUrl(videoSrc(video, 'mp4')),
          "uploadDate": video.uploadDate,
          "duration": `PT${video.seconds}S`,
          "width": video.width,
          "height": video.height,
          "publisher": { "@id": `${domain}/#organization` }
        }))
      }
    ]
  };
}
