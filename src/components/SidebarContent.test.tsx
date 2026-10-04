import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarContent, getAboutHeading } from './SidebarContent';
import { contentRegistry } from '@/data/contentRegistry';
import { typeGuides } from '@/data/typeGuides';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { pageCopy } from '../../tests/utils/pageCopy';

const renderSidebar = (toolId: string) =>
  render(
    <PageCopyContext.Provider value={pageCopy(toolId)}>
      <SidebarContent toolId={toolId} />
    </PageCopyContext.Provider>
  );

describe('getAboutHeading', () => {
  it('does not prefix names that already begin with "About"', () => {
    expect(getAboutHeading('About QRCraftly')).toBe('About QRCraftly');
    expect(getAboutHeading('about us')).toBe('about us');
  });

  it('prefixes other names', () => {
    expect(getAboutHeading('WiFi QR Code')).toBe('About WiFi QR Code');
    expect(getAboutHeading('Aboutique')).toBe('About Aboutique');
  });
});

describe('SidebarContent', () => {
  it('never renders an "About About" heading for a registry entry named "About ..."', () => {
    renderSidebar('about');
    expect(screen.queryByRole('heading', { name: /About About/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About QRCraftly' })).toBeInTheDocument();
  });

  it('keeps the "About" prefix for tool entries', () => {
    renderSidebar('wifi-qr-code');
    expect(screen.getByRole('heading', { level: 2, name: /^About WiFi/ })).toBeInTheDocument();
  });
});

describe('SidebarContent FAQs and intro', () => {
  const generatorIds = [
    'index', 'wifi-qr-code', 'vcard-qr-code', 'email-qr-code', 'sms-qr-code', 'phone-qr-code',
    'event-qr-code', 'location-qr-code', 'meeting-qr-code', 'payment-qr-code', 'social-qr-code', 'text-qr-code',
  ];

  it.each(generatorIds)('renders its own FAQ answers as text for %s, even while collapsed', (toolId) => {
    const faqs = pageCopy(toolId).faqs ?? [];
    expect(faqs.length).toBeGreaterThanOrEqual(4);
    const { container } = renderSidebar(toolId);
    // Answers must be in the rendered HTML so crawlers that do not run JS can read them.
    for (const faq of faqs) {
      expect(container.textContent).toContain(faq.answer);
    }
  });

  it('gives each generator page questions of its own', () => {
    const indexQuestions = new Set((pageCopy('index').faqs ?? []).map((f) => f.question));
    for (const toolId of generatorIds.filter((id) => id !== 'index')) {
      const own = (pageCopy(toolId).faqs ?? []).filter((f) => !indexQuestions.has(f.question));
      expect(own.length, toolId).toBeGreaterThanOrEqual(2);
    }
  });

  it('shows the homepage intro with a link to the pledge', () => {
    renderSidebar('index');
    expect(screen.getByText(contentRegistry['index'].intro ?? '')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the no-ads pledge' })).toHaveAttribute('href', '/free-forever');
  });
});

describe('SidebarContent internal linking (#1031)', () => {
  it('shows breadcrumbs, an example picture with alt text and related generator pages', () => {
    renderSidebar('wifi-qr-code');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    const example = screen.getByRole('img', { name: /Example of a QR code made with the WiFi QR Code Generator/ });
    expect(example).toHaveAttribute('src', '/examples/wifi-qr-code.svg');
    const related = screen.getByRole('heading', { level: 2, name: 'More QR code types' }).parentElement as HTMLElement;
    expect(related.querySelectorAll('a')).toHaveLength(4);
  });

  it('leaves the example and related list off pages that are not generators', () => {
    renderSidebar('security');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'More QR code types' })).not.toBeInTheDocument();
  });
});

describe('Generator page template (#1029)', () => {
  const typePages = [
    'wifi-qr-code', 'vcard-qr-code', 'email-qr-code', 'sms-qr-code', 'phone-qr-code', 'event-qr-code',
    'location-qr-code', 'meeting-qr-code', 'payment-qr-code', 'social-qr-code', 'text-qr-code',
  ];
  const words = (text: string) => text.trim().split(/\s+/).length;

  it.each(typePages)('%s carries 600 to 1,000 words under the template headings', (toolId) => {
    const { container } = renderSidebar(toolId);
    const total = words(container.textContent ?? '');
    expect(total).toBeGreaterThanOrEqual(600);
    expect(total).toBeLessThanOrEqual(1000);
    for (const name of [
      'What happens when someone scans it',
      'Use cases',
      'Tips for printing and sharing',
      'Privacy: where your data goes',
      'Frequently Asked Questions',
      'More QR code types',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it.each(typePages)('%s has a 40 to 60 word intro, a template title and a description of at most 155 characters', (toolId) => {
    const entry = contentRegistry[toolId];
    expect(words(typeGuides[toolId].intro)).toBeGreaterThanOrEqual(40);
    expect(words(typeGuides[toolId].intro)).toBeLessThanOrEqual(60);
    expect(entry.seoTitle).toMatch(/^Free .+ QR Code Generator: No Sign-up, Never Expires \| QRCraftly$/);
    expect(entry.description.length).toBeLessThanOrEqual(155);
  });

  it('puts the related links after the FAQ', () => {
    renderSidebar('wifi-qr-code');
    const faq = screen.getByRole('heading', { name: 'Frequently Asked Questions' });
    const related = screen.getByRole('heading', { name: 'More QR code types' });
    expect(faq.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
