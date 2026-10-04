import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AppShell } from './AppShell';
import QRTool from './QRTool';
import { ToastProvider } from './ui/Toast';
import { GENERATOR_FOOTER_LINKS, PRIMARY_NAV_ITEMS } from '@/data/navigation';

vi.mock('./QRCanvas', () => ({
  default: () => <div data-testid="qr-canvas-mock" />,
}));

let mockPathname = '/about';
vi.mock('vike-react/usePageContext', () => ({
  usePageContext: () => ({ urlPathname: mockPathname }),
}));

afterEach(() => {
  mockPathname = '/about';
});

function renderShell(children = <section>Page content</section>) {
  return render(<AppShell hydrated>{children}</AppShell>);
}

describe('AppShell', () => {
  it('renders one header, main landmark and footer around the page', () => {
    renderShell();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('Page content');
    expect(screen.getByRole('main')).toHaveAttribute('data-hydrated', 'true');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
  });

  it('puts the home link, every primary destination and the theme toggle in the header', () => {
    renderShell();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'QRCraftly Home' })).toHaveAttribute('href', '/');
    const nav = within(header).getByRole('navigation', { name: 'Primary navigation' });
    for (const item of PRIMARY_NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${item.label}`) })).toHaveAttribute('href', item.href);
    }
    expect(within(header).getByRole('button', { name: /theme/i })).toBeInTheDocument();
  });

  it('lists every generator, the tools and the company pages in the footer', () => {
    renderShell();
    const footer = screen.getByRole('contentinfo');
    const generators = within(footer).getByRole('navigation', { name: 'QR generators' });
    expect(within(generators).getAllByRole('link')).toHaveLength(GENERATOR_FOOTER_LINKS.length);
    expect(within(generators).getByRole('link', { name: 'WiFi QR Code' })).toHaveAttribute('href', '/wifi-qr-code');
    const tools = within(footer).getByRole('navigation', { name: 'Tools' });
    expect(within(tools).getByRole('link', { name: 'Send a File' })).toHaveAttribute('href', '/file-transfer');
    expect(within(tools).getByRole('link', { name: 'Receive a File' })).toHaveAttribute('href', '/file-transfer/receive');
    const company = within(footer).getByRole('navigation', { name: 'Company' });
    expect(within(company).getByRole('link', { name: 'Security Policy' })).toHaveAttribute('href', '/security#security');
    expect(within(company).getByRole('link', { name: 'Privacy Architecture' })).toHaveAttribute('href', '/security#compliance');
    expect(within(company).getByRole('link', { name: 'iPhone & Mac App Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(company).getByRole('link', { name: 'iPhone & Mac App Support' })).toHaveAttribute('href', '/support');
    expect(footer).toHaveTextContent(/Open Source/);
  });

  it('links the no-ads pledge and has no donation links', () => {
    renderShell();
    const footer = screen.getByRole('contentinfo');
    const pledgeLinks = within(footer).getAllByRole('link', { name: /pledge|no ads/i });
    expect(pledgeLinks.length).toBeGreaterThan(0);
    for (const link of pledgeLinks) {
      expect(link).toHaveAttribute('href', '/free-forever');
    }
    expect(footer.innerHTML).not.toMatch(/ko-fi/i);
  });

  it('wraps the generator without a second header, footer or diagnostics prompt', () => {
    mockPathname = '/';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <ToastProvider>
        <AppShell hydrated>
          <QRTool />
        </AppShell>
      </ToastProvider>,
    );
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Primary navigation' })).toHaveLength(1);
    expect(screen.queryByRole('switch', { name: /diagnostics/i })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('has no axe violations', async () => {
    const { container } = renderShell(<h1>Page</h1>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
