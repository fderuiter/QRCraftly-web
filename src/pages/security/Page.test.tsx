import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import docsManifest from 'virtual:docs-manifest';
import Page from './+Page';

describe('Security Page', () => {
  it('renders a single h1 and nested sub-headings', () => {
    const { container } = render(<Page />);

    // Check main heading (h1)
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/Security & Privacy Transparency Hub/i);
    // Site navigation and the footer come from the app shell, never from the page.
    expect(screen.queryByRole('navigation', { name: /Primary navigation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();

    // Verify sub-headings inside document sections are shifted down (depth + 1)
    // E.g., doc titles are h2. Any markdown headers that would have been h2 should now be h3, etc.
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.length).toBeGreaterThan(0);

    // Check that we don't have multiple nested heading violations (i.e. every heading from customMarked should be h3 or lower if it is parsed, check tags in container)
    const headers = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headers.forEach((header) => {
      // The only h1 should be the page title
      if (header.tagName === 'H1') {
        expect(header).toHaveTextContent(/Security & Privacy Transparency Hub/i);
      }
    });
  });

  it('appends unique, document-prefixed ID attributes to heading elements and rewrites cross-file links', () => {
    const { container } = render(<Page />);

    // Check heading ID for HIPAA Compliance Alignment in compliance document
    const complianceHeading = container.querySelector('#compliance-hipaa-compliance-alignment');
    expect(complianceHeading).not.toBeNull();
    expect(complianceHeading?.tagName).toBe('H3');
    expect(complianceHeading?.textContent).toBe('HIPAA Compliance Alignment');

    // Check heading ID for CI/CD Security Governance in security document
    const securityHeading = container.querySelector('#security-cicd-security-governance');
    expect(securityHeading).not.toBeNull();
    expect(securityHeading?.tagName).toBe('H3');
    expect(securityHeading?.textContent).toContain('CI/CD Security Governance');

    // Check link in security section pointing to COMPLIANCE.md is rewritten to #compliance
    const complianceLink = container.querySelector('#security-doc a[href="#compliance"]');
    expect(complianceLink).not.toBeNull();
    expect(complianceLink?.textContent).toBe('COMPLIANCE.md');
  });

  it('publishes only end-user documents, with shrinkable grid items and explicit typography (#978)', () => {
    const { container } = render(<Page />);
    expect(container.querySelector('#security')).not.toBeNull();
    expect(container.querySelector('#compliance')).not.toBeNull();
    for (const internal of ['style_guide', 'ui_catalog', 'scaling']) {
      expect(container.querySelector(`#${internal}`)).toBeNull();
    }
    expect(screen.queryByRole('heading', { name: /Design System Visual Style Guide|UI Component Registry|Capacity Planning/i })).not.toBeInTheDocument();

    const sections = container.querySelectorAll('section#security, section#compliance');
    sections.forEach((section) => {
      expect(section).toHaveClass('min-w-0');
      expect(section.className).not.toMatch(/\bprose\b/);
      const body = section.querySelector('[class*="[&_ul]:list-disc"]');
      expect(body).not.toBeNull();
      expect(body).toHaveClass('[&_pre]:overflow-x-auto');
    });
  });

  it('opens with a short summary of what happens to your data (#1056)', () => {
    const { container } = render(<Page />);
    const summary = container.querySelector('section#summary');
    expect(summary).not.toBeNull();
    // The summary is the first section of the article.
    expect(container.querySelector('article section')).toBe(summary);
    const items = within(summary as HTMLElement).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'Generated on your device',
      'Nothing uploaded',
      'No tracking cookies or trackers',
      'Cloudflare keeps standard request logs',
    ]);
    // Heading, lead and summary stay within 150 words.
    const header = container.querySelector('article header')?.textContent ?? '';
    const words = `${header} ${summary?.textContent ?? ''}`.split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(150);
  });

  it('collapses each policy document by default but keeps it in the HTML', () => {
    const { container } = render(<Page />);
    expect(docsManifest.map((doc) => doc.id).sort()).toEqual(['compliance', 'security']);
    for (const id of ['security', 'compliance']) {
      const body = container.querySelector(`#${id}-doc`);
      expect(body?.innerHTML.length).toBeGreaterThan(1000);
      expect(body?.closest('[role="region"]')).toHaveAttribute('hidden');
    }
  });

  it('lists every H2 section in the table of contents', () => {
    render(<Page />);
    const toc = screen.getAllByRole('navigation', { name: 'On this page' })[0];
    expect(within(toc).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#summary',
      '#security',
      '#compliance',
      '#report',
      '#content-section',
    ]);
  });

  it('uses brand tokens only and has no axe violations', async () => {
    const { container } = render(<Page />);
    expect(container.innerHTML).not.toMatch(/indigo|(?:bg|text|border)-(?:slate|teal)-\d/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
