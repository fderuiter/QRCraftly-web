/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { usePageContext } from 'vike-react/usePageContext';
import { Home } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QrIllustration } from '@/components/QrIllustration';
import { QR_TYPE_ROUTES, TOOL_LINKS } from '@/data/navigation';
import { QRType } from '@/types';

/** The most used generators and the file-transfer tools, offered on the 404 page. */
const QUICK_LINKS: readonly (readonly [string, string])[] = [
  ['Website URL', QR_TYPE_ROUTES[QRType.URL]],
  ['WiFi', QR_TYPE_ROUTES[QRType.WIFI]],
  ['Contact card', QR_TYPE_ROUTES[QRType.VCARD]],
  ['Text', QR_TYPE_ROUTES[QRType.TEXT]],
  ['Email', QR_TYPE_ROUTES[QRType.EMAIL]],
  ['Event', QR_TYPE_ROUTES[QRType.EVENT]],
  ...TOOL_LINKS.slice(0, 2),
];

/**
 * Error Page Component
 *
 * A missing page shows a broken-QR illustration, a way home and quick links to the most
 * used tools; any other error shows a short message and the way home.
 * @returns The error page layout.
 */
export default function Page() {
  const pageContext = usePageContext();
  const is404 = pageContext.is404;
  const home = (
    <ButtonLink href="/" variant="primary">
      <Home className="size-4" aria-hidden="true" />
      Go Home
    </ButtonLink>
  );

  if (!is404) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center text-fg-soft">
        <h1 className="mb-4 text-4xl font-bold">500 - Internal Server Error</h1>
        <p className="mb-8">Something went wrong on our end.</p>
        {home}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-center text-3xl font-bold text-fg">404 - Page Not Found</h1>
      <EmptyState
        level={2}
        illustration={<QrIllustration broken className="size-7 text-accent" />}
        title="This code doesn't lead anywhere"
        body="The page you are looking for does not exist. Nothing was uploaded or tracked."
        action={home}
      />
      <nav aria-labelledby="quick-links-title" className="mt-8">
        <h2 id="quick-links-title" className="mb-3 text-lg font-semibold text-fg">
          Popular tools
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_LINKS.map(([label, href]) => (
            <li key={href}>
              {/* nosemgrep: require-isdangerousurl -- QUICK_LINKS is a fixed list of internal paths */}
              <ButtonLink href={href} variant="outline" fullWidth>
                {label}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
