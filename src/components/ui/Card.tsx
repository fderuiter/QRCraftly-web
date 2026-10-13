import React from 'react';
import { mergeClasses } from './styles';

/**
 * Properties for the Card container component.
 */
export interface CardProps {
  /**
   * The content to render inside the card.
   */
  children: React.ReactNode;
  /**
   * Additional className to apply to the card wrapper.
   */
  className?: string;
  /**
   * Component variant. Defaults to "default".
   */
  variant?: 'default' | 'control';
  /**
   * Background classes. Fallback depends on variant.
   */
  bg?: string;
  /**
   * Border classes. Fallback depends on variant.
   */
  border?: string;
  /**
   * Shadow classes. Fallback depends on variant.
   */
  shadow?: string;
  /**
   * Padding classes. Fallback depends on variant.
   */
  padding?: string;
  /**
   * Rounded classes. Fallback depends on variant.
   */
  rounded?: string;
}

/**
 * A reusable, strictly presentational Card container component.
 * Supports customizable background, border, shadow, rounded corners, and padding.
 * @param root0 The properties object.
 * @param root0.children The content to render inside the card.
 * @param root0.className Additional className to apply to the card wrapper.
 * @param root0.variant Component variant. Defaults to "default".
 * @param root0.bg Background classes. Fallback depends on variant.
 * @param root0.border Border classes. Fallback depends on variant.
 * @param root0.shadow Shadow classes. Fallback depends on variant.
 * @param root0.padding Padding classes. Fallback depends on variant.
 * @param root0.rounded Rounded classes. Fallback depends on variant.
 * @returns The rendered Card component wrapper.
 */
export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  bg,
  border,
  shadow,
  padding,
  rounded,
}) => {
  const resolvedBg = bg ?? (variant === 'control' ? 'bg-surface-sunken' : 'bg-surface');
  const resolvedBorder = border ?? 'border border-line';
  const resolvedShadow = shadow ?? (variant === 'control' ? 'shadow-none' : 'shadow-raised');
  const resolvedPadding = padding ?? (variant === 'control' ? 'p-4' : 'p-8');
  const resolvedRounded = rounded ?? 'rounded-xl';

  const cardClasses = mergeClasses(
    resolvedBg,
    resolvedBorder,
    resolvedShadow,
    resolvedPadding,
    resolvedRounded,
    className
  );

  return (
    <div className={cardClasses}>
      {children}
    </div>
  );
};
