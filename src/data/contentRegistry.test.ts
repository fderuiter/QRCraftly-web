import { describe, it, expect } from 'vitest';
import { contentRegistry, auxiliaryRegistry, SchemaType, SchemaCategory, TargetPersona, StrategicValueCategory, hasValidOgImage, isToolContent, getMetadataForPath, getMetadataForPageContext, legacyRouteRegistry } from './contentRegistry';
import { CONTAINMENT_PROFILES } from '@/packages/qr-payload';
import { pageCopy } from '../../tests/utils/pageCopy';

describe('Content Registry Validation', () => {
  const STRICT_NO_CONTROL = CONTAINMENT_PROFILES.STRICT_NO_CONTROL;

  it('should conform to ToolContent schema and have no control characters', () => {
    Object.entries(contentRegistry).forEach(([key, tool]) => {
      const { howTo, faqs } = pageCopy(key);
      // 1. Structure validation
      expect(tool.id, `File src/data/contentRegistry.ts - Tool '${key}': Missing or invalid 'id'`).toBeTypeOf('string');
      expect(tool.name, `File src/data/contentRegistry.ts - Tool '${key}': Missing or invalid 'name'`).toBeTypeOf('string');
      expect(tool.url, `File src/data/contentRegistry.ts - Tool '${key}': Missing or invalid 'url'`).toBeTypeOf('string');
      expect(tool.description, `File src/data/contentRegistry.ts - Tool '${key}': Missing or invalid 'description'`).toBeTypeOf('string');
      expect(tool.seoTitle, `File src/data/contentRegistry.ts - Tool '${key}': Missing or invalid 'seoTitle'`).toBeTypeOf('string');
      expect(Array.isArray(tool.features), `File src/data/contentRegistry.ts - Tool '${key}': 'features' must be an array`).toBe(true);
      if (faqs !== undefined) {
        expect(Array.isArray(faqs), `File src/data/contentRegistry.ts - Tool '${key}': 'faqs' must be an array`).toBe(true);
      }

      if (howTo) {
        expect(howTo.name, `File src/data/contentRegistry.ts - Tool '${key}': 'howTo.name' missing or invalid`).toBeTypeOf('string');
        expect(howTo.description, `File src/data/contentRegistry.ts - Tool '${key}': 'howTo.description' missing or invalid`).toBeTypeOf('string');
        expect(Array.isArray(howTo.steps), `File src/data/contentRegistry.ts - Tool '${key}': 'howTo.steps' must be an array`).toBe(true);
        if (howTo.supply) {
          expect(Array.isArray(howTo.supply), `File src/data/contentRegistry.ts - Tool '${key}': 'howTo.supply' must be an array`).toBe(true);
        }
      }

      // 2. Character validation against all strings
      const checkString = (str: string, path: string) => {
        if (typeof str !== 'string') return;
        const match = str.match(STRICT_NO_CONTROL);
        if (match) {
          const charCode = match[0].charCodeAt(0).toString(16).toUpperCase();
          throw new Error(`File src/data/contentRegistry.ts - Tool '${tool.id}', Path '${path}': Contains invalid control or zero-width character (\\u${charCode.padStart(4, '0')}) in rule STRICT_NO_CONTROL`);
        }
      };

      checkString(tool.id, 'id');
      checkString(tool.name, 'name');
      checkString(tool.url, 'url');
      checkString(tool.description, 'description');
      if (tool.seoTitle !== undefined) {
        checkString(tool.seoTitle, 'seoTitle');
      }

      tool.features.forEach((feature, index) => {
        checkString(feature, `features[${index}]`);
      });

      if (howTo) {
        checkString(howTo.name, 'howTo.name');
        checkString(howTo.description, 'howTo.description');
        if (howTo.supply) {
          howTo.supply.forEach((item, index) => {
            checkString(item.name, `howTo.supply[${index}].name`);
          });
        }
        howTo.steps.forEach((step, index) => {
          checkString(step.name, `howTo.steps[${index}].name`);
          checkString(step.text, `howTo.steps[${index}].text`);
        });
      }

      if (faqs) {
        faqs.forEach((faq, index) => {
          expect(faq.question, `File src/data/contentRegistry.ts - Tool '${key}': 'faqs[${index}].question' missing or invalid`).toBeTypeOf('string');
          expect(faq.answer, `File src/data/contentRegistry.ts - Tool '${key}': 'faqs[${index}].answer' missing or invalid`).toBeTypeOf('string');
          checkString(faq.question, `faqs[${index}].question`);
          checkString(faq.answer, `faqs[${index}].answer`);
        });
      }
    });
  });

  it('should enforce strict persona and schema metadata completeness', () => {
    const validPersonas = Object.values(TargetPersona);
    const validValueProps = Object.values(StrategicValueCategory);
    const validSchemaTypes = Object.values(SchemaType);
    const validSchemaCategories = Object.values(SchemaCategory);

    // Verify exactly 27 registered pages exist and are fully populated (the two retired games
    // were consolidated into "arcade"; their routes live in legacyRouteRegistry; "free-forever"
    // is the no-ads pledge page; "qr-code-scanner" is the standalone scanner)
    const registryKeys = Object.keys(contentRegistry);
    expect(registryKeys.length).toBe(27);

    registryKeys.forEach((key) => {
      const tool = contentRegistry[key];

      // 1. Persona validation (Must be populated and be valid TargetPersona enum value)
      expect(tool.personas, `Tool '${key}' must have defined 'personas'`).toBeDefined();
      expect(Array.isArray(tool.personas), `Tool '${key}': 'personas' must be an array`).toBe(true);
      expect(tool.personas.length, `Tool '${key}': 'personas' array cannot be empty`).toBeGreaterThan(0);
      tool.personas.forEach((p) => {
        expect(validPersonas, `Tool '${key}': Persona '${p}' is not a valid TargetPersona enum value`).toContain(p);
      });

      // 2. Value proposition validation
      expect(tool.valueProposition, `Tool '${key}' must have a valid 'valueProposition'`).toBeDefined();
      expect(validValueProps, `Tool '${key}': Value proposition '${tool.valueProposition}' is not a valid StrategicValueCategory enum value`).toContain(tool.valueProposition);

      // 3. Schema Type validation
      expect(tool.schemaType, `Tool '${key}' must have 'schemaType' defined`).toBeDefined();
      if (Array.isArray(tool.schemaType)) {
        tool.schemaType.forEach((st) => {
          expect(validSchemaTypes, `Tool '${key}': Schema Type '${st}' is not a valid SchemaType enum value`).toContain(st);
        });
      } else {
        expect(validSchemaTypes, `Tool '${key}': Schema Type '${tool.schemaType}' is not a valid SchemaType enum value`).toContain(tool.schemaType);
      }

      // 4. Schema Category validation
      expect(tool.schemaCategory, `Tool '${key}' must have 'schemaCategory' defined`).toBeDefined();
      expect(validSchemaCategories, `Tool '${key}': Schema Category '${tool.schemaCategory}' is not a valid SchemaCategory enum value`).toContain(tool.schemaCategory);
    });
  });

  it('should enforce strict persona and strategic value classifications for all auxiliary routes', () => {
    const validPersonas = Object.values(TargetPersona);
    const validValueProps = Object.values(StrategicValueCategory);

    const auxKeys = Object.keys(auxiliaryRegistry);
    expect(auxKeys.length).toBeGreaterThan(0);

    auxKeys.forEach((key) => {
      const item = auxiliaryRegistry[key];

      expect(item.id, `Auxiliary item '${key}': Missing or invalid 'id'`).toBeTypeOf('string');
      expect(item.name, `Auxiliary item '${key}': Missing or invalid 'name'`).toBeTypeOf('string');
      expect(item.seoTitle, `Auxiliary item '${key}': Missing or invalid 'seoTitle'`).toBeTypeOf('string');
      expect(item.description, `Auxiliary item '${key}': Missing or invalid 'description'`).toBeTypeOf('string');

      // 1. Persona validation
      expect(item.personas, `Auxiliary route '${key}' must have defined 'personas'`).toBeDefined();
      expect(Array.isArray(item.personas), `Auxiliary route '${key}': 'personas' must be an array`).toBe(true);
      expect(item.personas.length, `Auxiliary route '${key}': 'personas' array cannot be empty`).toBeGreaterThan(0);
      item.personas.forEach((p) => {
        expect(validPersonas, `Auxiliary route '${key}': Persona '${p}' is not a valid TargetPersona enum value`).toContain(p);
      });

      // 2. Value proposition validation
      expect(item.valueProposition, `Auxiliary route '${key}' must have a valid 'valueProposition'`).toBeDefined();
      expect(validValueProps, `Auxiliary route '${key}': Value proposition '${item.valueProposition}' is not a valid StrategicValueCategory enum value`).toContain(item.valueProposition);
    });
  });

  it('should generate valid WebApplication, HowTo, and FAQPage schemas for all promoted standalone public tools', async () => {
    const { generateSchema } = await import('../utils/schemaGenerator');
    const promotedTools = ['arcade', 'security'];

    promotedTools.forEach((toolId) => {
      const tool = contentRegistry[toolId];
      expect(tool, `Tool '${toolId}' must exist in contentRegistry`).toBeDefined();

      const schema = generateSchema({ ...tool, ...pageCopy(toolId) }, 'https://qrcraftly.com', `/${toolId}`);
      expect(schema, `Schema for '${toolId}' must be generated`).toBeDefined();
      expect(schema['@context']).toBe('https://schema.org');

      const graph = schema['@graph'];
      expect(Array.isArray(graph)).toBe(true);

      const appEntity = graph.find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
      expect(appEntity, `Tool '${toolId}' must generate a WebApplication schema`).toBeDefined();

      const howToEntity = graph.find((g: any) => g['@type'] === 'HowTo');
      expect(howToEntity, `Tool '${toolId}' must generate a HowTo schema`).toBeDefined();

      const faqEntity = graph.find((g: any) => g['@type'] === 'FAQPage');
      expect(faqEntity, `Tool '${toolId}' must generate an FAQPage schema`).toBeDefined();
    });
  });

  it('should enforce mandatory Open Graph image attributes on all tool and auxiliary items', () => {
    Object.entries(contentRegistry).forEach(([key, tool]) => {
      expect(tool.image, `Tool '${key}' must have defined 'image'`).toBeTypeOf('string');
      expect(tool.image.length, `Tool '${key}' image string cannot be empty`).toBeGreaterThan(0);
      expect(tool.imageAlt, `Tool '${key}' must have defined 'imageAlt'`).toBeTypeOf('string');
      expect(tool.imageAlt.length, `Tool '${key}' imageAlt string cannot be empty`).toBeGreaterThan(0);

      expect(hasValidOgImage(tool), `Tool '${key}' failed hasValidOgImage type guard`).toBe(true);
      expect(isToolContent(tool), `Tool '${key}' failed isToolContent type guard`).toBe(true);
    });

    Object.entries(auxiliaryRegistry).forEach(([key, item]) => {
      expect(item.image, `Auxiliary '${key}' must have defined 'image'`).toBeTypeOf('string');
      expect(item.image.length, `Auxiliary '${key}' image string cannot be empty`).toBeGreaterThan(0);
      expect(item.imageAlt, `Auxiliary '${key}' must have defined 'imageAlt'`).toBeTypeOf('string');
      expect(item.imageAlt.length, `Auxiliary '${key}' imageAlt string cannot be empty`).toBeGreaterThan(0);

      expect(hasValidOgImage(item), `Auxiliary '${key}' failed hasValidOgImage type guard`).toBe(true);
    });
  });

  it('records the retired game routes as redirects to the arcade', () => {
    expect(contentRegistry['game']).toBeUndefined();
    expect(contentRegistry['destroy-the-qr']).toBeUndefined();
    expect(Object.keys(legacyRouteRegistry).sort()).toEqual(['destroy-the-qr', 'game']);
    for (const entry of Object.values(legacyRouteRegistry)) {
      expect(entry.canonicalPath).toBe('/arcade');
      expect(entry.redirectTo).toMatch(/^\/arcade\?mode=(blaster|simulator)$/);
      expect(hasValidOgImage(entry)).toBe(true);
    }
  });

  it('should resolve complete path metadata including image parameters for all public routes', () => {
    const testRoutes = [
      '/arcade',
      '/destroy-the-qr',
      '/game',
      '/security',
      '/file-transfer',
      '/email-qr-code',
      '/wifi-qr-code',
      '/about',
      '/'
    ];

    testRoutes.forEach((route) => {
      const meta = getMetadataForPath(route);
      expect(meta.title, `Route '${route}' missing title`).toBeTypeOf('string');
      expect(meta.description, `Route '${route}' missing description`).toBeTypeOf('string');
      expect(meta.image, `Route '${route}' missing image`).toBeTypeOf('string');
      expect(meta.image.length, `Route '${route}' image empty`).toBeGreaterThan(0);
      expect(meta.imageAlt, `Route '${route}' missing imageAlt`).toBeTypeOf('string');
      expect(meta.imageAlt.length, `Route '${route}' imageAlt empty`).toBeGreaterThan(0);
    });
  });
});

describe('page metadata fixes (#978)', () => {
  it('gives the 404 page its own title instead of the homepage title', () => {
    const meta = getMetadataForPageContext({ urlPathname: '/does-not-exist', is404: true });
    expect(meta.title).toBe('404 Page Not Found - QRCraftly');
    expect(getMetadataForPageContext({ urlPathname: '/gone', abortStatusCode: 404 }).title).toBe(meta.title);
    expect(getMetadataForPageContext({ urlPathname: '/' }).title).not.toBe(meta.title);
  });

  it('suffixes the destroy-the-qr title and spells vCard consistently', () => {
    expect(getMetadataForPageContext({ urlPathname: '/destroy-the-qr' }).title).toMatch(/ - QRCraftly$/);
    const vcard = getMetadataForPageContext({ urlPathname: '/vcard-qr-code' });
    expect(vcard.title).toContain('vCard');
    expect(`${vcard.title} ${vcard.description} ${vcard.imageAlt}`).not.toMatch(/VCard/);
  });
});
