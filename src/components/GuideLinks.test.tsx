import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContentContext } from '@/data/PageContentContext';
import { buildPageContent } from '@/data/pageContent';
import { GuideLinks } from './GuideLinks';

describe('GuideLinks', () => {
  it('renders nothing on a page without guides', () => {
    const { container } = render(
      <PageContentContext.Provider value={buildPageContent({ urlPathname: '/wifi-qr-code' })}>
        <GuideLinks />
      </PageContentContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('links the page’s guides under a Guides heading', () => {
    render(
      <PageContentContext.Provider value={buildPageContent({ urlPathname: '/qr-code-scanner' })}>
        <GuideLinks />
      </PageContentContext.Provider>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Guides' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'QR code scams (quishing)' })).toHaveAttribute('href', '/guides/qr-code-scams-quishing');
  });
});
