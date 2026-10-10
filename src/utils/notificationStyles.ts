import { AlertCircle, AlertTriangle, CheckCircle, Info, type LucideIcon } from 'lucide-react';

export type NotificationState = 'success' | 'error' | 'warning' | 'info';

/**
 * Returns the semantic colour-token classes for a notification state (see the design
 * tokens in src/layouts/index.css; they switch with the theme, so no `dark:` variants).
 * @param state The notification state type.
 * @returns Space-separated Tailwind classes for background, border and text.
 */
export function getNotificationColors(state: NotificationState): string {
  switch (state) {
    case 'success':
      return 'bg-success-soft border-success-line text-success';
    case 'error':
      return 'bg-danger-soft border-danger-line text-danger';
    case 'warning':
      return 'bg-warning-soft border-warning-line text-warning';
    case 'info':
      return 'bg-accent-soft border-accent-line text-accent-strong';
  }
}

/**
 * Returns the Lucide icon component for the specified notification state.
 * @param state The notification state type.
 * @returns The Lucide icon component.
 */
export function getNotificationIcon(state: NotificationState): LucideIcon {
  switch (state) {
    case 'success':
      return CheckCircle;
    case 'error':
      return AlertCircle;
    case 'warning':
      return AlertTriangle;
    case 'info':
      return Info;
  }
}
