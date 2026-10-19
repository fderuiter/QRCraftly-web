import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { PrimaryNav } from './PrimaryNav';
import { GENERATOR_FOOTER_LINKS, PRIMARY_NAV_ITEMS } from '@/data/navigation';

let mockPathname = '/';
vi.mock('vike-react/usePageContext', () => ({
  usePageContext: () => ({ urlPathname: mockPathname }),
}));

afterEach(() => {
  mockPathname = '/';
});

function openMenu() {
  const button = screen.getByRole('button', { name: 'Site menu' });
  fireEvent.click(button);
  return button;
}

function menuDialog() {
  return screen.getByRole('dialog', { name: 'Menu' });
}

describe('PrimaryNav', () => {
  it('renders every primary destination inline from the lg breakpoint with shared labels', () => {
    render(<PrimaryNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const list = within(nav).getByRole('list');
    expect(list).toHaveClass('hidden', 'lg:flex');
    for (const item of PRIMARY_NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(`^${item.label}`) })).toHaveAttribute('href', item.href);
    }
    expect(screen.getByRole('button', { name: 'Site menu' })).toHaveClass('lg:hidden');
  });

  it('shows the Beta tag', () => {
    render(<PrimaryNav />);
    expect(screen.getByRole('link', { name: /^File Transfer\s*Beta$/ })).toBeInTheDocument();
  });

  it('puts every destination in the narrow-screen menu dialog, so nothing is removed on mobile', () => {
    render(<PrimaryNav />);
    const button = openMenu();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    const dialog = menuDialog();
    const primary = within(dialog).getByRole('navigation', { name: 'Site menu' });
    expect(within(primary).getAllByRole('link')).toHaveLength(PRIMARY_NAV_ITEMS.length);
    expect(within(dialog).getByRole('link', { name: /File Transfer/ })).toHaveAttribute('href', '/file-transfer');
  });

  it('groups the QR code types and help pages below the primary destinations in the menu', () => {
    render(<PrimaryNav />);
    openMenu();
    const dialog = menuDialog();
    const types = within(dialog).getByRole('group', { name: 'QR code types' });
    expect(within(types).getByRole('heading', { level: 3, name: 'QR code types' })).toBeInTheDocument();
    expect(within(types).getByRole('link', { name: 'URL QR Code' })).toHaveAttribute('href', '/');
    expect(within(types).getByRole('link', { name: 'Bulk CSV QR Codes' })).toHaveAttribute('href', '/bulk-csv-qr-code');
    expect(within(types).getAllByRole('link')).toHaveLength(GENERATOR_FOOTER_LINKS.length);

    const help = within(dialog).getByRole('group', { name: 'Help' });
    expect(within(help).getByRole('heading', { level: 3, name: 'Help' })).toBeInTheDocument();
    expect(within(help).getByRole('link', { name: 'Guides' })).toHaveAttribute('href', '/guides');
    expect(within(help).getByRole('link', { name: 'No-Ads Pledge' })).toHaveAttribute('href', '/free-forever');
  });

  it('marks the current secondary link with aria-current="page"', () => {
    mockPathname = '/guides/';
    render(<PrimaryNav />);
    openMenu();
    const help = within(menuDialog()).getByRole('group', { name: 'Help' });
    expect(within(help).getByRole('link', { name: 'Guides' })).toHaveAttribute('aria-current', 'page');
    expect(within(help).getByRole('link', { name: 'No-Ads Pledge' })).not.toHaveAttribute('aria-current');
  });

  it('closes the menu when a QR code type link is chosen', () => {
    render(<PrimaryNav />);
    const button = openMenu();
    fireEvent.click(within(menuDialog()).getByRole('link', { name: 'Text QR Code' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current destination with aria-current="page"', () => {
    mockPathname = '/about';
    render(<PrimaryNav />);
    openMenu();
    const dialog = menuDialog();
    expect(within(dialog).getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
    expect(within(dialog).getByRole('link', { name: 'Security' })).not.toHaveAttribute('aria-current');
  });

  it('marks File Transfer as active for both sender and receiver routes', () => {
    mockPathname = '/file-transfer/receive';
    render(<PrimaryNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(nav).getByRole('link', { name: /File Transfer/ })).toHaveAttribute('aria-current', 'page');
  });

  it('treats every generator route as "Create QR" and animates the inline indicator only with motion allowed', () => {
    mockPathname = '/wifi-qr-code';
    render(<PrimaryNav />);
    const inline = within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: 'Create QR' });
    expect(inline).toHaveAttribute('aria-current', 'page');
    expect(inline.className).toContain('after:scale-x-100');
    expect(inline.className).toContain('motion-safe:after:duration-base');
    expect(inline.className).toContain('motion-reduce:after:transition-none');
  });

  it('Escape closes the menu and restores focus to its button', () => {
    render(<PrimaryNav />);
    const button = openMenu();
    const link = within(menuDialog()).getByRole('link', { name: 'About' });
    link.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(button);
  });

  it('traps Tab focus inside the menu', () => {
    render(<PrimaryNav />);
    openMenu();
    const dialog = menuDialog();
    const focusables = within(dialog).getAllByRole('link');
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes after a link is chosen', () => {
    render(<PrimaryNav />);
    const button = openMenu();
    fireEvent.click(within(menuDialog()).getByRole('link', { name: 'Security' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps 44px targets inline and 48px targets in the menu', () => {
    render(<PrimaryNav />);
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    within(nav).getAllByRole('link').forEach((link) => expect(link.className).toContain('min-h-11'));
    const button = openMenu();
    expect(button.className).toContain('size-11');
    within(menuDialog()).getByRole('navigation', { name: 'Site menu' }).querySelectorAll('a').forEach((link) => {
      expect(link.className).toContain('min-h-12');
    });
    within(menuDialog()).getByRole('group', { name: 'QR code types' }).querySelectorAll('a').forEach((link) => {
      expect(link.className).toContain('min-h-11');
    });
  });

  it('has no axe violations closed or open', async () => {
    const { container } = render(<PrimaryNav />);
    expect(await axe(container)).toHaveNoViolations();
    openMenu();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
