import type { HTMLAttributes } from 'react';

/** Badge colour roles. */
export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'beta';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-fg-soft',
  brand: 'bg-accent-soft text-accent-strong',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  beta: 'bg-accent-soft text-accent-strong ring-1 ring-accent-line',
};

/** Properties for {@link Badge}. */
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colour role (default `neutral`). */
  tone?: BadgeTone;
}

/**
 * Small pill for a status or tag ("Beta", "Active", "Sample Preview"). Text is 12px, the
 * caption size; colours come from the semantic tokens and meet 4.5:1 in both themes.
 * @param props - Badge properties; other span attributes pass through.
 * @param props.tone - Colour role.
 * @param props.className - Extra layout classes (margins).
 * @param props.children - Badge text, optionally with a small icon.
 * @returns The badge.
 */
export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]} ${className}`.trim()}
      {...props}
    >
      {children}
    </span>
  );
}
