import { describe, it, expect } from 'vitest';
import { generateSchema } from './schemaGenerator';
import type { ToolCopy } from '../data/copy/types';
import { ToolContent, SchemaType, SchemaCategory, TargetPersona, StrategicValueCategory } from '../data/contentRegistry';
import { safeJsonLdStringify } from './security';

describe('schemaGenerator', () => {
  const dummyContent: ToolContent & ToolCopy = {
    id: 'wifi',
    name: 'WiFi QR Code Generator',
    description: 'Generate free wifi qr code',
    url: 'https://qrcraftly.com/wifi',
    image: '/og/wifi-qr-code.png',
    imageAlt: 'WiFi QR Code Generator',
    features: ['WPA', 'WPA2'],
    schemaType: [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    schemaCategory: SchemaCategory.UtilitiesApplication,
    personas: [TargetPersona.SecurityConsciousEnterprise],
    valueProposition: StrategicValueCategory.AsynchronousWebWorkerDiagnostics,
    howTo: {
      name: 'How to generate Wifi QR Code',
      description: 'Follow these steps',
      steps: [
        { name: 'Enter SSID', text: 'Type your network name' },
      ],
      supply: [
        { name: 'Internet connection' }
      ]
    },
    faqs: [
      { question: 'Is it free?', answer: 'Yes' }
    ]
  };

  const aboutContent: ToolContent & ToolCopy = {
    id: 'about',
    name: 'About QRCraftly',
    description: 'We are a secure QR code generator',
    url: 'https://qrcraftly.com/about',
    image: '/og-image.png?type=about',
    imageAlt: 'About QRCraftly',
    features: [],
    schemaType: SchemaType.AboutPage,
    schemaCategory: SchemaCategory.UtilitiesApplication,
    personas: [TargetPersona.HealthcareLegal],
    valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty,
    faqs: [
      { question: 'What is this?', answer: 'An app' }
    ]
  };

  it('generates standard AboutPage schema when id is about', () => {
    const schema = generateSchema(aboutContent);
    expect(schema).toBeDefined();
    expect(schema['@context']).toBe('https://schema.org');
    const aboutPage = schema['@graph'][0];
    expect(aboutPage['@type']).toBe('AboutPage');
    expect(aboutPage['mainEntity']).toEqual({
      "@id": "https://qrcraftly.com/#organization"
    });
    expect(schema['@graph'][1]['@type']).toBe('FAQPage');
  });

  it('generates standard dual-type schema for tool content', () => {
    const schema = generateSchema(dummyContent);
    expect(schema).toBeDefined();
    expect(schema['@context']).toBe('https://schema.org');
    
    // Check dual-type app
    const app = schema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('SoftwareApplication') && g['@type'].includes('WebApplication'));
    expect(app).toBeDefined();
    expect(app.name).toBe(dummyContent.name);
    expect(app.applicationCategory).toBe('UtilitiesApplication');
    expect(app.featureList).toBe('Asynchronous Web Worker Diagnostics, WPA, WPA2');
    // Real package version, no placeholder publish date.
    expect(app.softwareVersion).toBe(__APP_VERSION__);
    expect(app.softwareVersion).not.toBe('0.1.0');
    expect(app.datePublished).toBeUndefined();
    
    // Check HowTo
    const howTo = schema['@graph'].find((g: any) => g['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    // No HowTo image is published: the old /assets/images/completed/ URLs never existed.
    expect(howTo.image).toBeUndefined();
    expect(howTo.supply).toBeDefined();
    expect(howTo.supply[0].name).toBe('Internet connection');

    // Check FAQPage
    const faq = schema['@graph'].find((g: any) => g['@type'] === 'FAQPage');
    expect(faq).toBeDefined();
  });

  it('handles optional parameters resolvedDomain and requestPath', () => {
    const schema = generateSchema(dummyContent, 'https://test.domain.com', '/request-path');
    const app = schema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
    expect(app.url).toContain('/request-path');
    expect(app.image).toBe('https://test.domain.com/og/wifi-qr-code.png');

    const howTo = schema['@graph'].find((g: any) => g['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    // No HowTo image is published: the old /assets/images/completed/ URLs never existed.
    expect(howTo.image).toBeUndefined();
  });

  it('handles howTo without supply or faq list', () => {
    const contentNoSupply: ToolContent & ToolCopy = {
      ...dummyContent,
      howTo: {
        name: 'Steps',
        description: 'Do it',
        steps: [{ name: 'Step 1', text: 'Press button' }]
        // supply is undefined
      },
      faqs: undefined
    };
    const schema = generateSchema(contentNoSupply);
    const howTo = schema['@graph'].find((g: any) => g['@type'] === 'HowTo');
    expect(howTo).toBeDefined();
    expect(howTo.supply).toBeUndefined();

    const faq = schema['@graph'].find((g: any) => g['@type'] === 'FAQPage');
    expect(faq).toBeUndefined();
  });

  it('handles about page schema without faqs', () => {
    const aboutNoFaqs = { ...aboutContent, faqs: undefined };
    const schema = generateSchema(aboutNoFaqs);
    expect(schema['@graph']).toHaveLength(1);
    expect(schema['@graph'][0]['@type']).toBe('AboutPage');
    const hasFaqPage = schema['@graph'].some((item: any) => item['@type'] === 'FAQPage');
    expect(hasFaqPage).toBe(false);
  });

  it('handles about page schema with empty faqs array', () => {
    const aboutEmptyFaqs = { ...aboutContent, faqs: [] };
    const schema = generateSchema(aboutEmptyFaqs);
    expect(schema['@graph']).toHaveLength(1);
    expect(schema['@graph'][0]['@type']).toBe('AboutPage');
    const hasFaqPage = schema['@graph'].some((item: any) => item['@type'] === 'FAQPage');
    expect(hasFaqPage).toBe(false);
  });

  it('handles tool content without howTo', () => {
    const noHowTo: ToolContent & ToolCopy = {
      ...dummyContent,
      howTo: undefined,
    };
    const schema = generateSchema(noHowTo);
    const howTo = schema['@graph'].find((g: any) => g['@type'] === 'HowTo');
    expect(howTo).toBeUndefined();
  });

  it('does NOT generate specialized schemas for event, location, meeting, and social tool IDs but retains WebApplication', () => {
    const eventContent: ToolContent = {
      id: 'event-qr-code',
      name: 'Event QR',
      description: 'Generate Event QR',
      url: 'https://qrcraftly.com/event-qr-code',
      image: '/og-image.png?type=event',
      imageAlt: 'Event QR',
      features: [],
      schemaType: [SchemaType.WebApplication],
      schemaCategory: SchemaCategory.UtilitiesApplication,
      personas: [TargetPersona.SecurityConsciousEnterprise],
      valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty
    };
    const eventSchema = generateSchema(eventContent);
    const eventObj = eventSchema['@graph'].find((g: any) => g['@type'] === 'Event');
    const placeObjInEvent = eventSchema['@graph'].find((g: any) => g['@type'] === 'Place');
    expect(eventObj).toBeUndefined();
    expect(placeObjInEvent).toBeUndefined();
    const eventApp = eventSchema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
    expect(eventApp).toBeDefined();

    const locationContent: ToolContent = {
      id: 'location-qr-code',
      name: 'Location QR',
      description: 'Generate Location QR',
      url: 'https://qrcraftly.com/location-qr-code',
      image: '/og-image.png?type=location',
      imageAlt: 'Location QR',
      features: [],
      schemaType: [SchemaType.WebApplication],
      schemaCategory: SchemaCategory.UtilitiesApplication,
      personas: [TargetPersona.HealthcareLegal],
      valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty
    };
    const locationSchema = generateSchema(locationContent);
    const locationObj = locationSchema['@graph'].find((g: any) => g['@type'] === 'Place');
    expect(locationObj).toBeUndefined();
    const locationApp = locationSchema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
    expect(locationApp).toBeDefined();

    const meetingContent: ToolContent = {
      id: 'meeting-qr-code',
      name: 'Meeting QR',
      description: 'Generate Meeting QR',
      url: 'https://qrcraftly.com/meeting-qr-code',
      image: '/og-image.png?type=meeting',
      imageAlt: 'Meeting QR',
      features: [],
      schemaType: [SchemaType.WebApplication],
      schemaCategory: SchemaCategory.UtilitiesApplication,
      personas: [TargetPersona.SecurityConsciousEnterprise],
      valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty
    };
    const meetingSchema = generateSchema(meetingContent);
    const meetingObj = meetingSchema['@graph'].find((g: any) => g['@type'] === 'Event');
    expect(meetingObj).toBeUndefined();
    const meetingApp = meetingSchema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
    expect(meetingApp).toBeDefined();

    const socialContent: ToolContent = {
      id: 'social-qr-code',
      name: 'Social QR',
      description: 'Generate Social QR',
      url: 'https://qrcraftly.com/social-qr-code',
      image: '/og-image.png?type=social',
      imageAlt: 'Social QR',
      features: [],
      schemaType: [SchemaType.WebApplication],
      schemaCategory: SchemaCategory.SocialNetworkingApplication,
      personas: [TargetPersona.SecurityConsciousEnterprise],
      valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty
    };
    const socialSchema = generateSchema(socialContent);
    const socialObj = socialSchema['@graph'].find((g: any) => g['@type'] === 'ProfilePage');
    expect(socialObj).toBeUndefined();
    const socialApp = socialSchema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('WebApplication'));
    expect(socialApp).toBeDefined();
  });

  it('supports schemaType and schemaCategory overrides directly from registry', () => {
    // 1. Single schemaType override
    const overrideTypeString: ToolContent = {
      ...dummyContent,
      schemaType: SchemaType.AboutPage,
      schemaCategory: SchemaCategory.SocialNetworkingApplication
    };
    const schema1 = generateSchema(overrideTypeString);
    const app1 = schema1['@graph'].find((g: any) => g['@type'] === 'AboutPage');
    expect(app1).toBeDefined();
    expect(app1.applicationCategory).toBe('SocialNetworkingApplication');

    // 2. Array schemaType override
    const overrideTypeArray: ToolContent = {
      ...dummyContent,
      schemaType: [SchemaType.SoftwareApplication, SchemaType.WebApplication],
      schemaCategory: SchemaCategory.BusinessApplication
    };
    const schema2 = generateSchema(overrideTypeArray);
    const app2 = schema2['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('SoftwareApplication') && g['@type'].includes('WebApplication'));
    expect(app2).toBeDefined();
    expect(app2.applicationCategory).toBe('BusinessApplication');
  });

  it('successfully injects user segment values (audience) into the output JSON-LD structure', () => {
    const schema = generateSchema(dummyContent);
    const app = schema['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('SoftwareApplication'));
    expect(app).toBeDefined();
    expect(app.audience).toBeDefined();
    expect(app.audience).toEqual([
      {
        "@type": "Audience",
        "audienceType": "Security-Conscious Enterprise"
      }
    ]);
  });

  it('handles empty or undefined personas on about page and standard tool', () => {
    // 1. About Page without personas
    const aboutNoPersonas = { ...aboutContent, personas: undefined } as any;
    const schemaAboutNo = generateSchema(aboutNoPersonas);
    expect(schemaAboutNo['@graph'][0].audience).toBeUndefined();

    // 2. About Page with empty personas
    const aboutEmptyPersonas = { ...aboutContent, personas: [] };
    const schemaAboutEmpty = generateSchema(aboutEmptyPersonas);
    expect(schemaAboutEmpty['@graph'][0].audience).toBeUndefined();

    // 3. Standard Tool without personas
    const toolNoPersonas = { ...dummyContent, personas: undefined } as any;
    const schemaToolNo = generateSchema(toolNoPersonas);
    const appNo = schemaToolNo['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('SoftwareApplication'));
    expect(appNo.audience).toBeUndefined();

    // 4. Standard Tool with empty personas
    const toolEmptyPersonas = { ...dummyContent, personas: [] };
    const schemaToolEmpty = generateSchema(toolEmptyPersonas);
    const appEmpty = schemaToolEmpty['@graph'].find((g: any) => Array.isArray(g['@type']) && g['@type'].includes('SoftwareApplication'));
    expect(appEmpty.audience).toBeUndefined();
  });

  it('generates complete schema directly from route path strings for all public tool routes', () => {
    const publicRoutes = [
      'arcade',
      'security',
      'file-transfer',
      'email-qr-code',
      'wifi-qr-code',
      'about'
    ];

    publicRoutes.forEach((route) => {
      const schema = generateSchema(route, 'https://qrcraftly.com', `/${route}`);
      expect(schema).toBeDefined();
      expect(schema['@context']).toBe('https://schema.org');
      expect(Array.isArray(schema['@graph'])).toBe(true);
      expect(schema['@graph'].length).toBeGreaterThan(0);

      // Verify JSON-LD output sanitization with safeJsonLdStringify
      const jsonString = safeJsonLdStringify(schema);
      expect(jsonString).not.toContain('<script>');
      expect(jsonString).not.toContain('</script>');
    });
  });
});
