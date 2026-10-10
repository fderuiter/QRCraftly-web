import type { ReactNode } from 'react';

/** Properties for {@link EmptyState}. */
interface EmptyStateProps {
  /** Decorative illustration or icon (it is hidden from assistive technology). */
  illustration?: ReactNode;
  /** Short heading saying what is empty. */
  title: ReactNode;
  /** One or two sentences on what to do next. */
  body?: ReactNode;
  /** Optional next step, usually a `Button` or `ButtonLink`. */
  action?: ReactNode;
  /** Heading level of the title (default 3). */
  level?: 2 | 3 | 4;
  /** Id for the body text (so a disabled control can point at it with `aria-describedby`). */
  bodyId?: string;
  /** Extra layout classes. */
  className?: string;
}

/**
 * Placeholder for a list or panel with nothing to show yet: an illustration slot, a title,
 * a short explanation and an optional action, centred in a dashed well.
 * @param props - Empty state properties.
 * @returns The empty state.
 */
export function EmptyState({ illustration, title, body, action, level = 3, bodyId, className = '' }: EmptyStateProps) {
  const Heading = `h${level}` as const;
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-surface-sunken p-6 text-center ${className}`.trim()}
    >
      {illustration && (
        <div aria-hidden="true" className="mb-1 flex size-12 items-center justify-center rounded-full bg-surface-hover text-fg-muted">
          {illustration}
        </div>
      )}
      <Heading className="text-base font-semibold text-fg">{title}</Heading>
      {body && (
        <p id={bodyId} className="max-w-xs text-sm text-fg-muted">
          {body}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
