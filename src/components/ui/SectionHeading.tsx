import type { ReactNode } from 'react';

/** Eyebrow text colour: `muted` (default), `strong` (body text colour) or `accent` (brand). */
type EyebrowTone = 'muted' | 'strong' | 'accent';

const TONE_CLASSES: Record<EyebrowTone, string> = {
  muted: 'text-fg-muted',
  strong: 'text-fg',
  accent: 'text-accent',
};

const EYEBROW_CLASSES = 'flex items-center gap-2 text-xs font-semibold tracking-wider uppercase';

/** Properties for {@link Eyebrow}. */
interface EyebrowProps {
  /** Label text, optionally after an icon. */
  children: ReactNode;
  /** Text colour role. */
  tone?: EyebrowTone;
  /** Extra layout classes (margins). */
  className?: string;
}

/**
 * Small uppercase caption above a heading or a value ("The QRCraftly Pledge", "Live readout").
 * It is not a heading; use {@link SectionHeading} when the label names a section.
 * @param props - Eyebrow properties.
 * @returns The caption.
 */
export function Eyebrow({ children, tone = 'muted', className = '' }: EyebrowProps) {
  return <p className={`${EYEBROW_CLASSES} ${TONE_CLASSES[tone]} ${className}`.trim()}>{children}</p>;
}

/** Properties for {@link SectionHeading}. */
interface SectionHeadingProps {
  /** Heading text. Without it, the eyebrow itself is the heading. */
  title?: ReactNode;
  /** Small uppercase label above the title, or on its own as a caption heading. */
  eyebrow?: ReactNode;
  /** Optional supporting sentence under the title. */
  description?: ReactNode;
  /** Heading level of the element that carries the text (default 2). */
  level?: 2 | 3 | 4;
  /** Eyebrow colour role. */
  tone?: EyebrowTone;
  /** Optional icon before the heading text. */
  icon?: ReactNode;
  /** Id for the heading element (for `aria-labelledby`). */
  id?: string;
  /** Extra layout classes (margins). */
  className?: string;
}

/**
 * Section heading: an optional uppercase eyebrow, a title and an optional description.
 * Without a `title` the eyebrow itself is the heading (the compact caption style used for
 * panel sections such as "Content" or "Transfer progress"). Text sizes follow the type
 * scale: the eyebrow is a 12px caption, the title 18px.
 * @param props - Heading properties.
 * @returns The heading block.
 */
export function SectionHeading({ title, eyebrow, description, level = 2, tone = 'muted', icon, id, className = '' }: SectionHeadingProps) {
  const Heading = `h${level}` as const;

  if (!title) {
    return (
      <Heading id={id} className={`${EYEBROW_CLASSES} ${TONE_CLASSES[tone]} ${className}`.trim()}>
        {icon}
        {eyebrow}
      </Heading>
    );
  }

  return (
    <div className={className || undefined}>
      {eyebrow && (
        <Eyebrow tone={tone} className="mb-1">
          {eyebrow}
        </Eyebrow>
      )}
      <Heading id={id} className="flex items-center gap-2 text-lg font-semibold text-fg">
        {icon}
        {title}
      </Heading>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
    </div>
  );
}
