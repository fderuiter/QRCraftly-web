import { cloneElement, type ReactElement, useEffect, useId, useState } from 'react';

/** Properties a tooltip trigger must accept. */
interface TriggerProps {
  'aria-describedby'?: string;
}

/** Properties for {@link Tooltip}. */
interface TooltipProps {
  /** Short text shown on hover and keyboard focus. */
  content: string;
  /** The control it describes: one focusable element (usually a `Button` or link). */
  children: ReactElement<TriggerProps>;
  /** Side of the trigger the bubble appears on (default `top`). */
  side?: 'top' | 'bottom';
}

/* Padding (not margin) bridges trigger and bubble, so the pointer can move onto the bubble. */
const SIDE_CLASSES = {
  top: 'bottom-full pb-2',
  bottom: 'top-full pt-2',
} as const;

/**
 * Whether an element shows keyboard focus (pointer clicks do not open the tooltip).
 * @param target - The focused element.
 * @returns True for keyboard focus, or when the browser cannot tell.
 */
function isKeyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * Text bubble for a control, shown while the pointer hovers it or it has keyboard focus,
 * and dismissed with Escape (WCAG 1.4.13: hoverable, persistent and dismissible). While shown,
 * the text is linked to the trigger with `aria-describedby`; the trigger still needs its own
 * accessible name (`aria-label` on icon-only buttons). Use it instead of the native `title` attribute, which keyboard and
 * touch users never see.
 * @param props - Tooltip properties.
 * @returns The trigger wrapped with its tooltip.
 */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const id = `tooltip-${useId()}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The bubble exists only while shown, so it adds nothing to the server-rendered page.
  const describedBy = [children.props['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <span
      className="relative inline-flex shrink-0"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={(event) => {
        if (isKeyboardFocus(event.target)) setOpen(true);
      }}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      {open && (
        <span className={`absolute left-1/2 z-50 -translate-x-1/2 ${SIDE_CLASSES[side]}`}>
          <span
            id={id}
            role="tooltip"
            className="block rounded-md bg-fg px-2 py-1 text-xs font-medium whitespace-nowrap text-surface shadow-overlay motion-safe:animate-rise-in"
          >
            {content}
          </span>
        </span>
      )}
    </span>
  );
}
