import type { HTMLAttributes } from 'react';

/** Properties for {@link Kbd}. */
type KbdProps = HTMLAttributes<HTMLElement>;

/**
 * A keyboard key cap for shortcut hints ("Ctrl", "K", "?"). It renders a real `<kbd>` element,
 * so assistive technology reads it as keyboard input; the colours are semantic tokens and meet
 * 4.5:1 in both themes. Put one `Kbd` around each key of a combination.
 * @param props - Element properties; other attributes pass through.
 * @param props.className - Extra layout classes (margins).
 * @param props.children - The key label.
 * @returns The key cap.
 */
export function Kbd({ className = '', children, ...props }: KbdProps) {
  return (
    <kbd
      className={`inline-flex min-w-6 items-center justify-center rounded-md border border-line-strong bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-fg-soft ${className}`.trim()}
      {...props}
    >
      {children}
    </kbd>
  );
}
