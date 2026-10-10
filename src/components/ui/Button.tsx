import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, forwardRef, type MouseEvent } from 'react';
import { isDangerousUrl } from '@/utils/security';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'error'
  | 'danger'
  | 'ghost'
  | 'outline'
  | 'menuitem'
  | 'icon'
  | 'disclosure'
  | 'dropzone'
  | 'segment'
  | 'tile';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'bar' | 'icon' | 'none';

interface ButtonStyleProps {
  /** Colour and shape role. Layout variants (`menuitem`, `disclosure`, `dropzone`, `segment`, `tile`) set their own size. */
  variant?: ButtonVariant;
  /** Padding, radius and text size. `bar` is `md` that grows to the 48px touch height below `md`. */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** `round` makes the button a pill (or a circle when `iconOnly`). */
  shape?: 'default' | 'round';
}

/**
 * An icon-only button has no visible text, so it must carry an accessible name.
 * The union makes `aria-label` a compile-time requirement whenever `iconOnly` is set.
 */
type IconOnlyProps =
  | {
      /** Square button sized for one icon (`xs` 24px, `sm` 32px, `md` 40px like a text button, `lg` 44px touch target). */
      iconOnly: true;
      'aria-label': string;
    }
  | { iconOnly?: false };

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonStyleProps &
  IconOnlyProps & {
    /**
     * Toggle/selection state. When provided, the button exposes `aria-pressed` and, when
     * true, swaps the variant colours for a selected style defined for both light and dark
     * themes (thicker ring plus colour, so selection is not conveyed by colour alone).
     * Use this instead of passing selected-state border classes through `className`,
     * which lose to the variant's `dark:` classes.
     */
    pressed?: boolean;
    /**
     * Shows a spinner in place of the content (the button keeps its width), sets `aria-busy`
     * and ignores clicks until the work finishes. Pass it for actions that take a moment,
     * such as encoding an export.
     */
    loading?: boolean;
  };

/**
 * Selected-state styles shared by the action variants. Border and ring colours meet the
 * 3:1 non-text contrast minimum against both the light and dark surfaces.
 */
const PRESSED_STYLES =
  'bg-accent-soft border border-accent-strong ring-1 ring-accent-strong text-accent-strong font-semibold hover:bg-surface-hover';

/** Selected styles of the layout variants used by `SegmentedControl`. */
const SELECTED_STYLES: Partial<Record<ButtonVariant, string>> = {
  segment: 'text-fg font-semibold',
  tile: 'border-accent-strong bg-accent-soft text-accent-strong font-semibold',
};

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-action hover:bg-action-hover shadow-raised text-on-action',
  secondary: 'bg-accent-soft border border-accent-line hover:bg-surface-hover text-accent',
  error: 'bg-danger-action text-on-action hover:bg-danger-action-hover shadow-raised',
  danger: 'bg-transparent hover:bg-danger-soft text-danger',
  outline: 'bg-surface-raised border border-line hover:bg-surface-hover text-fg-soft',
  ghost: 'bg-transparent hover:bg-surface-hover text-fg-muted',
  menuitem: 'bg-transparent hover:bg-surface-hover text-fg-soft',
  icon: 'bg-transparent hover:bg-surface-hover hover:text-fg text-fg-muted',
  disclosure: 'bg-transparent hover:bg-surface-hover text-fg',
  dropzone:
    'bg-surface-raised border-2 border-dashed border-line text-fg-soft hover:border-accent hover:bg-accent-soft data-dragover:border-accent data-dragover:bg-accent-soft',
  segment: 'bg-transparent text-fg-muted hover:text-fg',
  tile: 'bg-surface-raised border border-line text-fg-soft hover:border-line-strong hover:bg-surface-hover',
};

/** Spinner colour per variant while `loading` (the label itself turns transparent). */
const SPINNER_COLOR: Record<ButtonVariant, string> = {
  primary: 'border-on-action',
  error: 'border-on-action',
  secondary: 'border-accent',
  danger: 'border-danger',
  outline: 'border-fg-soft',
  ghost: 'border-fg-muted',
  menuitem: 'border-fg-soft',
  icon: 'border-fg-muted',
  disclosure: 'border-fg',
  dropzone: 'border-accent',
  segment: 'border-fg',
  tile: 'border-accent',
};

/** Layout variants replace the size scale with their own box. */
const VARIANT_LAYOUT: Partial<Record<ButtonVariant, string>> = {
  menuitem: 'flex gap-2 items-center min-h-11 px-4 py-2.5 rounded-none text-left text-sm w-full',
  disclosure: 'flex w-full min-h-11 items-center justify-between gap-2 px-5 py-4 rounded-none text-left',
  dropzone: 'size-full flex-col gap-1 p-6 rounded-xl text-center',
  segment: 'relative z-10 min-h-9 gap-1.5 px-3 py-1.5 rounded-lg text-sm',
  tile: 'relative min-h-11 flex-col gap-1 p-2 rounded-lg text-sm text-center',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  xs: 'gap-1 px-2 py-1 rounded-md text-sm',
  sm: 'gap-1.5 px-3 py-1.5 rounded-lg text-sm',
  md: 'gap-2 px-4 py-2.5 rounded-xl text-sm',
  lg: 'gap-2 px-6 py-3 rounded-xl text-base',
  bar: 'gap-2 px-4 py-2.5 rounded-xl text-sm max-md:min-h-12',
  icon: 'p-2 rounded-xl',
  none: '',
};

const ICON_ONLY_SIZE_STYLES: Record<ButtonSize, string> = {
  xs: 'size-6 rounded-md',
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-xl',
  lg: 'size-11 rounded-xl',
  bar: 'h-10 w-12 shrink-0 rounded-xl max-md:h-12',
  icon: 'p-2 rounded-xl',
  none: '',
};

/**
 * Builds the class list shared by `Button` and `ButtonLink`.
 * @param options Variant, size, shape, width, selection state and extra classes.
 * @returns The combined class string.
 */
function buttonClassName({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  shape = 'default',
  iconOnly = false,
  pressed,
  className = '',
}: ButtonStyleProps & { iconOnly?: boolean; pressed?: boolean; className?: string }): string {
  const layout = VARIANT_LAYOUT[variant];
  const baseStyles =
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 font-medium inline-flex items-center transition duration-(--duration-fast) ease-standard';
  // Subtle pressed feedback for compact controls; full-width rows and drop zones stay still.
  const press = variant === 'menuitem' || variant === 'disclosure' || variant === 'dropzone' ? '' : 'motion-safe:active:scale-98';
  const justify = layout?.includes('justify-between') ? '' : 'justify-center';

  let variantStyles = VARIANT_STYLES[variant];
  if (pressed === true) {
    variantStyles = SELECTED_STYLES[variant] ? `${variantStyles} ${SELECTED_STYLES[variant]}` : PRESSED_STYLES;
  }

  const sizeStyles = layout ?? (iconOnly ? ICON_ONLY_SIZE_STYLES[size] : SIZE_STYLES[size]);
  const shapeStyles = shape === 'round' ? 'rounded-full' : '';
  const widthStyles = fullWidth ? 'w-full' : '';

  return `${baseStyles} ${press} ${justify} ${variantStyles} ${sizeStyles} ${shapeStyles} ${widthStyles} ${className}`
    .replace(/\s+/g, ' ')
    .trim();
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'secondary',
      size = 'md',
      fullWidth = false,
      shape,
      iconOnly,
      type = 'button',
      pressed,
      loading,
      onClick,
      children,
      ...props
    },
    ref
  ) => {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (loading) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    };
    return (
      <button
        ref={ref}
        type={type}
        className={buttonClassName({
          variant,
          size,
          fullWidth,
          shape,
          iconOnly,
          pressed,
          // A transparent label (and currentColor icons) keeps the width and the accessible name.
          className: loading ? `relative text-transparent! ${className}` : loading === false ? `relative ${className}` : className,
        })}
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        onClick={handleClick}
        {...props}
      >
        {children}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className={`size-4 rounded-full border-2 border-t-transparent motion-safe:animate-spin ${SPINNER_COLOR[variant]}`} />
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  ButtonStyleProps &
  IconOnlyProps & {
    href: string;
  };

/**
 * Link mode of `Button`: a link styled as a button, for navigation that should look like an
 * action (for example "Go Home" or "View on GitHub"). It takes the same `variant`, `size`,
 * `shape`, `iconOnly` and `fullWidth` props and renders a real `<a>`, so it keeps link
 * semantics, middle-click and prefetching. Unsafe URLs render nothing.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className = '', variant = 'secondary', size = 'md', fullWidth = false, shape, iconOnly, href, children, ...props }, ref) => {
    if (!isDangerousUrl(href)) {
      return (
        <a ref={ref} href={href} className={buttonClassName({ variant, size, fullWidth, shape, iconOnly, className })} {...props}>
          {children}
        </a>
      );
    }
    return null;
  }
);

ButtonLink.displayName = 'ButtonLink';
