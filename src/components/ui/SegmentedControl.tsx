import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { Check } from 'lucide-react';
import { Button } from './Button';

/** One option of a {@link SegmentedControl}. */
export interface SegmentedOption<T extends string> {
  /** Value reported to `onChange`. */
  value: T;
  /** Visible content (text, or an icon plus text). */
  label: ReactNode;
  /** Accessible name when the visible content is not a good name. */
  ariaLabel?: string;
  /** Id of an element that describes this option. */
  describedBy?: string;
}

/** Properties for {@link SegmentedControl}. */
interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. Use `labelledBy` instead when a visible label exists. */
  label?: string;
  /** Id of the visible element that names the group. */
  labelledBy?: string;
  /** Options in order. */
  options: readonly SegmentedOption<T>[];
  /** Selected value. */
  value: T;
  /** Called with the newly selected value. */
  onChange: (value: T) => void;
  /**
   * `track` (default): equal segments in a sunken track with a sliding selection thumb.
   * `tiles`: a grid of bordered tiles; the selected one gets a filled tint and a check badge.
   */
  appearance?: 'track' | 'tiles';
  /** `radiogroup` (default) for settings, `tablist` for switching panels. */
  kind?: 'radiogroup' | 'tablist';
  /** Layout classes for the group (grid columns, gaps, margins). */
  className?: string;
  /** For tabs: id of the panel each tab controls. */
  controls?: (value: T) => string;
  /** For tabs: id given to each tab so its panel can reference it. */
  tabId?: (value: T) => string;
  /** Disables every option (for example while a transfer runs). */
  disabled?: boolean;
}

/** Thumb widths for one to six equal segments (static class names so Tailwind can see them). */
const THUMB_WIDTH: Record<number, string> = {
  1: 'w-full',
  2: 'w-1/2',
  3: 'w-1/3',
  4: 'w-1/4',
  5: 'w-1/5',
  6: 'w-1/6',
};

/** Thumb offsets: the thumb moves by whole segment widths. */
const THUMB_OFFSET: Record<number, string> = {
  0: 'translate-x-0',
  1: 'translate-x-full',
  2: 'translate-x-[200%]',
  3: 'translate-x-[300%]',
  4: 'translate-x-[400%]',
  5: 'translate-x-[500%]',
};

/**
 * Single-select control with WAI-ARIA radio group (or tab list) semantics: one tab stop
 * (roving tabindex), Arrow keys, Home and End move the selection, and `aria-checked` /
 * `aria-selected` carry the state. Selection is shown by a filled thumb or tile plus a
 * check badge, distinct from the keyboard focus ring. Motion is skipped under reduced motion.
 * @param props - Control properties.
 * @returns The segmented control.
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  appearance = 'track',
  kind = 'radiogroup',
  className = '',
  controls,
  tabId,
  disabled,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const isTabs = kind === 'tablist';
  const isTrack = appearance === 'track';
  // -1 when nothing is selected (for example a custom colour that matches no preset).
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = Math.max(0, selectedIndex);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = options.length;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const groupClasses = isTrack
    ? `relative grid auto-cols-fr grid-flow-col rounded-xl bg-surface-hover p-1 ${className}`
    : `grid gap-2 ${className}`;

  return (
    <div role={kind} aria-label={label} aria-labelledby={labelledBy} className={groupClasses.trim()}>
      {isTrack && selectedIndex >= 0 && options.length <= 6 && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-1">
          <span
            data-testid="segmented-thumb"
            className={`block h-full rounded-lg bg-surface-raised shadow-raised ring-1 ring-line motion-safe:transition-transform motion-safe:duration-(--duration-base) motion-safe:ease-standard ${THUMB_WIDTH[options.length]} ${THUMB_OFFSET[selectedIndex]}`}
          />
        </span>
      )}
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <Button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role={isTabs ? 'tab' : 'radio'}
            id={tabId?.(option.value)}
            aria-checked={isTabs ? undefined : selected}
            aria-selected={isTabs ? selected : undefined}
            aria-controls={controls?.(option.value)}
            aria-label={option.ariaLabel}
            aria-describedby={option.describedBy}
            variant={isTrack ? 'segment' : 'tile'}
            pressed={selected}
            aria-pressed={undefined}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
            {!isTrack && selected && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-action text-on-action motion-safe:animate-pop-in"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
