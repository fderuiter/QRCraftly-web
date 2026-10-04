import type { Guide } from '../data/guides';
import type { ToolCopy } from '../data/copy/types';
import { ToolContent, AuxiliaryContent, getContentForPath, getContentById } from '../data/contentRegistry';
import { resolveDomainForPath, resolvePublicUrl, JsonLdObject } from './metadataEngine';

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

    const faqs = (content as ToolContent & ToolCopy).faqs;
    if (faqs && faqs.length > 0) {
      aboutGraph.push({
        "@type": "FAQPage",
        "mainEntity": faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.answer
          }
        }))
      });
    }

    if (content.personas && content.personas.length > 0) {
      aboutGraph[0].audience = content.personas.map(persona => ({
        "@type": "Audience",
        "audienceType": persona
      }));
    }

    return {
      "@context": "https://schema.org",
      "@graph": aboutGraph
    };
  }

  const toolContent = content as ToolContent & ToolCopy;
  const typeValue = toolContent.schemaType || "WebApplication";
  const categoryValue = toolContent.schemaCategory || "UtilitiesApplication";

  const featureList = [toolContent.valueProposition, ...(toolContent.features || [])].filter(Boolean).join(", ");

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

  if (content.personas && content.personas.length > 0) {
    appEntity.audience = content.personas.map(persona => ({
      "@type": "Audience",
      "audienceType": persona
    }));
  }

  const graph: JsonLdObject[] = [appEntity];

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
      "tool": [
        {
          "@type": "HowToTool",
          "name": `QRCraftly ${content.name.replace(' QR Code Generator', '')} Generator`
        }
      ],
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

  if (toolContent.faqs && toolContent.faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "mainEntity": toolContent.faqs.map(faq => ({
        "@type": "Question",
        "name": faq.question,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": faq.answer
        }
      }))
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
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
