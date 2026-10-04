/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { SectionHeading } from './ui/SectionHeading';
import type { ReactNode } from 'react';
import { QrCode } from 'lucide-react';
import { isDangerousUrl } from '@/utils/security';
import { PrimaryNav } from './ui/PrimaryNav';
import { ThemeToggle } from './ui/ThemeToggle';
import { PLEDGE_TAGLINE } from '@/data/pledge';
import { GENERATOR_FOOTER_LINKS, TOOL_LINKS, USE_CASE_LINKS } from '@/data/navigation';

const FOOTER_LINK_CLASSES = 'transition-colors hover:text-accent';

const COMPANY_LINKS = [
  ['About', '/about'],
  ['Guides', '/guides'],
  ['No-Ads Pledge', '/free-forever'],
  ['Security Policy', '/security#security'],
  ['Privacy Architecture', '/security#compliance'],
  ['Open-Source Licenses', '/acknowledgements'],
  ['iPhone & Mac App Privacy', '/privacy'],
  ['iPhone & Mac App Support', '/support'],
] as const;

/**
 * A footer link list, skipping any destination that is not a safe URL.
 * @param root0 - Component properties.
 * @param root0.links - Label and destination pairs.
 * @param root0.className - Classes for the list.
 * @returns The list.
 */
function FooterLinks({ links, className }: { links: readonly (readonly [string, string])[]; className: string }) {
  return (
    <ul className={className}>
      {links.map(([label, href]) => {
        if (!isDangerousUrl(href)) {
          return (
            <li key={href}>
              <a href={href} className={FOOTER_LINK_CLASSES}>
                {label}
              </a>
            </li>
          );
        }
        return null;
      })}
    </ul>
  );
}

/**
 * The one header every route shares: home link, primary navigation and theme toggle.
 * @returns The app header.
 */
export function AppHeader() {
  return (
    <header className="border-b border-line bg-surface transition-colors duration-300" data-testid="app-header">
      <div className="flex items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <a
          href="/"
          aria-label="QRCraftly Home"
          className="flex min-h-11 min-w-0 items-center gap-2 text-accent transition-opacity hover:opacity-80"
        >
          <QrCode className="size-7 shrink-0" aria-hidden="true" />
          <span className="text-xl font-bold tracking-tight text-fg">QRCraftly</span>
        </a>
        <div className="flex shrink-0 items-center gap-1">
          <PrimaryNav />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * The one footer every route shares: generators, tools, company links and the pledge tagline.
 * @returns The app footer.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-line bg-surface transition-colors duration-300" data-testid="app-footer">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_2fr_1fr_1fr]">
        <div>
          <a href="/" className="inline-flex items-center gap-2 font-bold text-fg">
            <QrCode className="size-5 text-accent" aria-hidden="true" />
            QRCraftly
          </a>
          <p className="mt-3 max-w-sm text-sm text-fg-muted">Private, browser-based tools for creating and sharing QR codes.</p>
        </div>
        <nav aria-label="QR generators">
          <SectionHeading eyebrow="Generators" tone="strong" className="mb-3" />
          <FooterLinks links={GENERATOR_FOOTER_LINKS} className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm text-fg-muted" />
        </nav>
        <div>
          <nav aria-label="Tools">
            <SectionHeading eyebrow="Tools" tone="strong" className="mb-3" />
            <FooterLinks links={TOOL_LINKS} className="space-y-2 text-sm text-fg-muted" />
          </nav>
          <nav aria-label="Popular uses" className="mt-6">
            <SectionHeading eyebrow="Popular uses" tone="strong" className="mb-3" />
            <FooterLinks links={USE_CASE_LINKS} className="space-y-2 text-sm text-fg-muted" />
          </nav>
        </div>
        <nav aria-label="Company">
          <SectionHeading eyebrow="Company" tone="strong" className="mb-3" />
          <FooterLinks links={COMPANY_LINKS} className="space-y-2 text-sm text-fg-muted" />
          <ul className="mt-2 text-sm text-fg-muted">
            <li>
              <a href="https://github.com/fderuiter/QRCraftly" target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASSES}>
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <p className="mx-auto max-w-7xl border-t border-line-subtle px-4 py-5 text-xs text-fg-muted sm:px-6">
        <a href="/free-forever" className="font-medium text-fg-muted hover:text-accent">
          {PLEDGE_TAGLINE}
        </a>{' '}
        &copy; {new Date().getFullYear()} QRCraftly. Open Source.
      </p>
    </footer>
  );
}

/**
 * The single app shell used by every route (applied once in `LayoutDefault`): skip link,
 * header, main landmark and footer on one page background.
 * @param root0 - Component properties.
 * @param root0.children - Page content.
 * @param root0.hydrated - Whether the client has hydrated (exposed as `data-hydrated` on main).
 * @returns The page inside the app shell.
 */
export function AppShell({ children, hydrated = false }: { children: ReactNode; hydrated?: boolean }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-page font-sans text-fg-soft antialiased" data-testid="app-shell">
      <a
        href="#main-content"
        className="sr-only transition-all focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:border-2 focus:border-accent focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-accent focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none" data-hydrated={hydrated}>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
