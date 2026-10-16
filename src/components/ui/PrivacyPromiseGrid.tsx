import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { mergeClasses } from './styles';

/**
 * Single item in a privacy promise grid card.
 */
export interface PrivacyPromiseItem {
  /** Icon component to render at the start of the card item. */
  icon: LucideIcon;
  /** Primary title of the promise card. */
  title: string;
  /** Secondary explanatory text of the promise card. */
  text: string;
}

/**
 * Props for {@link PrivacyPromiseGrid}.
 */
export interface PrivacyPromiseGridProps {
  /** List of promise items to display in the grid. */
  items: readonly PrivacyPromiseItem[];
  /** Number of columns on small screens and above (2 or 3). Defaults to 3. */
  columns?: 2 | 3;
  /** Accessible label for the list element. */
  ariaLabel?: string;
  /** Additional CSS class names to apply to the grid container. */
  className?: string;
}

/**
 * Grid list component encapsulating privacy promise card rendering for tool pages.
 * @param props Component properties.
 * @param props.items List of promise items to display.
 * @param props.columns Number of columns on small screens and above.
 * @param props.ariaLabel Accessible label for the list container.
 * @param props.className Additional container styling.
 * @returns The rendered grid list.
 */
export function PrivacyPromiseGrid({
  items,
  columns = 3,
  ariaLabel,
  className,
}: PrivacyPromiseGridProps) {
  const columnClass = columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  const gridClasses = mergeClasses('grid gap-3', columnClass, className);

  return (
    <ul className={gridClasses} aria-label={ariaLabel || undefined}>
      {items.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
          <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-semibold text-fg">{title}</p>
            <p className="text-sm text-fg-muted">{text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
