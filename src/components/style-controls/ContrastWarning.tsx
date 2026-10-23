import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

/**
 * Props for the ContrastBadge component.
 */
export interface ContrastBadgeProps {
  /**
   * Whether the low contrast warning is active and visible.
   */
  isVisible: boolean;
  /**
   * The calculated contrast ratio to display.
   */
  contrastRatio: number;
  /**
   * Decimal precision format for the displayed contrast value.
   * Defaults to 1 decimal place.
   */
  decimalPrecision?: number;
  /**
   * Whether the badge announces itself to screen readers. Turn this off when a
   * ContrastBanner on the same panel already announces the same warning, so one
   * change is announced once. Defaults to true.
   */
  announce?: boolean;
  /**
   * Optional test ID for automated testing compatibility.
   */
  'data-testid'?: string;
}

/**
 * A centralized inline badge component for standardizing visual style,
 * text size, and screen-reader polite notifications for low-contrast warnings.
 */
export const ContrastBadge: React.FC<ContrastBadgeProps> = ({
  isVisible,
  contrastRatio,
  decimalPrecision = 1,
  announce = true,
  'data-testid': dataTestId,
}) =>
  isVisible ? (
    <span
      aria-live={announce ? 'polite' : undefined}
      aria-atomic={announce ? true : undefined}
      className="inline-block text-xs font-medium text-warning"
      data-testid={dataTestId}
    >
      <span className="flex items-center gap-1">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Low Contrast ({contrastRatio.toFixed(decimalPrecision)})
      </span>
    </span>
  ) : null;

/**
 * Props for the ContrastBanner component.
 */
export interface ContrastBannerProps {
  /**
   * Whether the warning banner is active and visible.
   */
  isVisible: boolean;
  /**
   * The calculated contrast ratio to display.
   */
  contrastRatio: number;
  /**
   * The context message type to display.
   */
  messageType: 'color' | 'layout';
  /**
   * Decimal precision format for the displayed contrast value.
   * Defaults to 2 decimal places.
   */
  decimalPrecision?: number;
  /**
   * Additional CSS classes to apply to the alert wrapper.
   */
  className?: string;
  /**
   * Optional callback triggered when the inline auto-fix action button is clicked.
   */
  onAutoFix?: () => void;
  /**
   * Label text for the inline auto-fix button. Defaults to "Fix contrast".
   */
  autoFixLabel?: string;
}

/**
 * A centralized warning banner component that unifies bottom styling alert boxes,
 * providing standard screen-reader dynamic notifications and customizable precision.
 */
export const ContrastBanner: React.FC<ContrastBannerProps> = ({
  isVisible,
  contrastRatio,
  messageType,
  decimalPrecision = 2,
  className = '',
  onAutoFix,
  autoFixLabel = 'Fix contrast',
}) => (
  <div role="status" aria-live="polite" aria-atomic="true">
    {isVisible && (
      <Alert variant="warning" className={className} role="note">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {messageType === 'color' ? 'Warning: ' : ''}The contrast ratio is low ({contrastRatio.toFixed(decimalPrecision)}). {messageType === 'color' ? 'Aim for 4.5:1 for scannability.' : 'Ensure contrast is above 4.5:1 for export legibility.'}
          </span>
          {onAutoFix && (
            <Button variant="primary" size="sm" onClick={onAutoFix} className="shrink-0">
              {autoFixLabel}
            </Button>
          )}
        </div>
      </Alert>
    )}
  </div>
);
