import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { auxiliaryRegistry } from '@/data/contentRegistry';
import { guides, readingMinutes } from '@/data/guides';
import { generateGuideIndexSchema, generateGuideSchema } from '@/utils/schemaGenerator';
import { GuideArticle, formatGuideDate, renderInline } from './GuideArticle';

describe('guides data', () => {
  it('has unique slugs, registry entries and resolvable related links', () => {
    const slugs = guides.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const guide of guides) {
      const entry = auxiliaryRegistry[`guides/${guide.slug}`];
      expect(entry?.seoTitle).toBe(guide.seoTitle);
      expect(entry?.description).toBe(guide.description);
      expect(entry?.name).toBe(guide.shortTitle);
      expect(guide.sources.length).toBeGreaterThan(0);
      expect(guide.dateModified >= guide.datePublished).toBe(true);
      expect(readingMinutes(guide)).toBeGreaterThan(0);
      for (const related of guide.related) expect(slugs).toContain(related);
      for (const source of guide.sources) expect(source.url.startsWith('https://')).toBe(true);
    }
  });

  it('keeps every section id unique within a guide', () => {
    for (const guide of guides) {
      const ids = guide.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('GuideArticle', () => {
  it('renders the title, byline, sections and sources without axe violations', async () => {
    const guide = guides[0];
    const { container } = render(<GuideArticle guide={guide} />);
    expect(screen.getByRole('heading', { level: 1, name: guide.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText(/min read/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('formats dates in UTC', () => {
    expect(formatGuideDate('2026-10-03')).toBe('3 October 2026');
  });

  it('turns safe links into anchors and drops dangerous ones to plain text', () => {
    render(<p>{renderInline('See [home](/guides) and [bad](javascript:alert(1)).')}</p>);
    expect(screen.getByRole('link', { name: 'home' })).toHaveAttribute('href', '/guides');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByText(/bad/)).toBeInTheDocument();
  });
});

describe('guide schema', () => {
  it('describes an Article authored by the organization', () => {
    const guide = guides[0];
    const [article] = generateGuideSchema(guide, 'https://qrcraftly.com')['@graph'] as Array<Record<string, unknown>>;
    expect(article['@type']).toBe('Article');
    expect(article.author).toEqual({ '@id': 'https://qrcraftly.com/#organization' });
    expect(article.dateModified).toBe(guide.dateModified);
  });

  it('describes the index as a collection page', () => {
    const [page] = generateGuideIndexSchema('Guides', 'https://qrcraftly.com')['@graph'] as Array<Record<string, unknown>>;
    expect(page['@type']).toBe('CollectionPage');
  });
});
