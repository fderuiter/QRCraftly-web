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

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { usePageContext } from 'vike-react/usePageContext';
import { Button } from './Button';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { isDangerousUrl } from '@/utils/security';
import {
  GENERATOR_FOOTER_LINKS,
  HELP_LINKS,
  PRIMARY_NAV_ITEMS,
  type PrimaryNavItem,
  getCurrentPrimaryNavId,
  normalizePathname,
} from '@/data/navigation';

/**
 * Returns the current pathname from Vike's page context, falling back to the browser
 * location (for components rendered outside Vike, such as isolated tests).
 * @returns The current pathname.
 */
function useCurrentPathname(): string {
  const pageContext = usePageContext() as { urlPathname?: string } | undefined;
  if (pageContext?.urlPathname) return pageContext.urlPathname;
  return typeof window !== 'undefined' ? window.location.pathname : '/';
}

const LINK_BASE_CLASSES =
  'relative flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-surface-hover hover:text-accent';

/* Inline links get an underline that grows in from the centre (motion-safe) on the current page. */
const INLINE_INDICATOR_CLASSES =
  'after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:origin-center after:rounded-full after:bg-accent after:transition-transform motion-safe:after:duration-base motion-reduce:after:transition-none';

const LINK_IDLE_CLASSES = 'text-fg-muted after:scale-x-0';
const LINK_CURRENT_CLASSES = 'text-accent-strong after:scale-x-100';

/**
 * One navigation link, marked with `aria-current="page"` when it owns the current route.
 * @param root0 - Component properties.
 * @param root0.item - The destination.
 * @param root0.isCurrent - Whether it is the current page.
 * @param root0.inline - Whether it sits in the inline desktop bar (animated indicator) or the menu.
 * @param root0.onNavigate - Called when the link is activated.
 * @returns The list item, or nothing when the destination is not a safe URL.
 */
function NavLink({
  item,
  isCurrent,
  inline = false,
  onNavigate,
}: {
  item: PrimaryNavItem;
  isCurrent: boolean;
  inline?: boolean;
  onNavigate?: () => void;
}) {
  const { href } = item;
  if (!isDangerousUrl(href)) {
    const stateClasses = isCurrent ? LINK_CURRENT_CLASSES : LINK_IDLE_CLASSES;
    const menuCurrent = !inline && isCurrent ? 'bg-accent-soft' : '';
    return (
      <li>
        <a
          href={href}
          aria-current={isCurrent ? 'page' : undefined}
          onClick={onNavigate}
          className={`${LINK_BASE_CLASSES} ${inline ? INLINE_INDICATOR_CLASSES : 'min-h-12'} ${stateClasses} ${menuCurrent}`.trim()}
        >
          <span>{item.label}</span>
          {item.tag && <Badge tone="beta">{item.tag}</Badge>}
        </a>
      </li>
    );
  }
  return null;
}

/**
 * A labelled group of secondary links in the site menu (QR code types, Help). The current
 * page is marked with `aria-current="page"`, as the primary links are.
 * @param root0 - Component properties.
 * @param root0.title - Group heading, also the group's accessible name.
 * @param root0.links - Label and destination pairs.
 * @param root0.pathname - The current pathname.
 * @param root0.onNavigate - Called when a link is activated.
 * @returns The labelled navigation group.
 */
function MenuSection({
  title,
  links,
  pathname,
  onNavigate,
}: {
  title: string;
  links: readonly (readonly [label: string, href: string])[];
  pathname: string;
  onNavigate: () => void;
}) {
  const headingId = useId();
  const current = normalizePathname(pathname);
  return (
    <div role="group" aria-labelledby={headingId} className="border-t border-line-subtle pt-4">
      <h3 id={headingId} className="mb-1 px-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h3>
      <ul>
        {links.map(([label, href]) => {
          if (isDangerousUrl(href)) return null;
          const isCurrent = normalizePathname(href) === current;
          return (
            <li key={href}>
              <a
                href={href}
                aria-current={isCurrent ? 'page' : undefined}
                onClick={onNavigate}
                className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors hover:bg-surface-hover hover:text-accent ${isCurrent ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted'}`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Site-wide primary navigation built from the shared `PRIMARY_NAV_ITEMS` data model and
 * rendered once, in the app shell header. From the `lg` breakpoint every destination is an
 * inline link; below it a menu button opens a dialog listing the same links, which traps
 * focus, closes with Escape or a backdrop press and returns focus to the button.
 * Targets are at least 44px (48px in the menu).
 * @returns The primary navigation landmark.
 */
export function PrimaryNav() {
  const pathname = useCurrentPathname();
  const currentId = getCurrentPrimaryNavId(pathname);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Return focus to the menu button whenever the dialog closes (Safari never focuses a clicked button).
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <nav aria-label="Primary navigation" className="flex items-center">
      <ul className="hidden items-center gap-0.5 lg:flex">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <NavLink key={item.id} item={item} isCurrent={item.id === currentId} inline />
        ))}
      </ul>
      <Button
        ref={buttonRef}
        variant="icon"
        iconOnly
        size="lg"
        shape="round"
        className="lg:hidden"
        aria-label="Site menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MenuIcon className="size-5" aria-hidden="true" />
      </Button>
      <Modal isOpen={open} onClose={close} title="Menu" dismissOnBackdropClick>
        <nav aria-label="Site menu">
          <ul className="space-y-1">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <NavLink key={item.id} item={item} isCurrent={item.id === currentId} onNavigate={close} />
            ))}
          </ul>
        </nav>
        <div className="mt-4 space-y-4">
          <MenuSection title="QR code types" links={GENERATOR_FOOTER_LINKS} pathname={pathname} onNavigate={close} />
          <MenuSection title="Help" links={HELP_LINKS} pathname={pathname} onNavigate={close} />
        </div>
      </Modal>
    </nav>
  );
}
