import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';
import { compileBreadcrumbSchema } from '@/utils/metadataEngine';

describe('Breadcrumbs', () => {
  it('renders nothing on the home page', () => {
    const { container } = render(<Breadcrumbs pageId="index" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links Home and marks the current page', () => {
    render(<Breadcrumbs pageId="wifi-qr-code" />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByText('WiFi QR Code')).toHaveAttribute('aria-current', 'page');
  });

  it('links each parent of a nested route', () => {
    render(<Breadcrumbs pageId="file-transfer/receive" />);
    expect(screen.getByRole('link', { name: 'File Transfer' })).toHaveAttribute('href', '/file-transfer');
    expect(screen.getByText('Receive')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the same trail as the BreadcrumbList data for each content page', () => {
    const pageIds = ['about', 'privacy', 'free-forever', 'support', 'acknowledgements', 'guides', 'guides/why-qr-codes-stop-working'];
    for (const pageId of pageIds) {
      const { unmount } = render(<Breadcrumbs pageId={pageId} />);
      const shown = screen.getAllByRole('listitem').map((item) => item.textContent?.replace(/^\/\s*/, '').trim());
      const schema = compileBreadcrumbSchema(`/${pageId}`);
      const expected = schema.itemListElement.map((item: { name: string }) => item.name);
      expect(shown).toEqual(expected);
      unmount();
    }
  });
});
