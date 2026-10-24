/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Badge } from './ui/Badge';
import React, { useEffect, useRef } from 'react';
import { Eye } from 'lucide-react';
import { isDangerousUrl } from '@/packages/core/security';
import { PanelErrorBoundary } from './ErrorBoundary';

/** Media query matching the desktop workspace breakpoint (Tailwind `md`). */
export const DESKTOP_WORKSPACE_QUERY = '(min-width: 48rem)';

/**
 * Props for {@link ToolWorkspaceLayout}.
 */
export interface ToolWorkspaceLayoutProps {
  /** Tool header (page heading and tool actions). Sticky only on desktop. */
  header: React.ReactNode;
  /** Primary controls, shown first on every viewport. */
  controls: React.ReactNode;
  /** Preview or camera surface. Follows the primary controls on mobile; sticky right column on desktop. */
  preview: React.ReactNode;
  /** Optional secondary controls: after the preview on mobile, below the primary controls on desktop. */
  secondary?: React.ReactNode;
  /** Accessible name of the control column. */
  controlsLabel: string;
  /** Accessible name of the preview region. */
  previewLabel: string;
  /** DOM id of the preview region, used by "jump to preview" links. */
  previewId?: string;
  /**
   * Makes the desktop preview scroller a tab stop. Set it when the preview holds no
   * focusable controls (only a canvas), so keyboard users can still scroll it (axe
   * `scrollable-region-focusable`).
   */
  previewFocusable?: boolean;
}

/**
 * Shared responsive workspace used by the QR generator, file sender and file receiver.
 * Each panel has its own error boundary, so a crash in one panel leaves the others working.
 *
 * Mobile contract: normal document flow in one column (controls, preview, secondary controls),
 * no viewport-height panes and no nested scroll containers, so the document is the only
 * vertical scrolling surface. Desktop (`md` and up): a fixed-width control column beside a
 * sticky, viewport-height preview column that scrolls independently when it overflows.
 * @param props - Layout slots and labels.
 * @param props.header - Tool header.
 * @param props.controls - Primary controls.
 * @param props.preview - Preview surface.
 * @param props.secondary - Optional secondary controls.
 * @param props.controlsLabel - Accessible name of the control column.
 * @param props.previewLabel - Accessible name of the preview region.
 * @param props.previewId - DOM id of the preview region.
 * @returns The workspace layout.
 */
export function ToolWorkspaceLayout({
  header,
  controls,
  preview,
  secondary,
  controlsLabel,
  previewLabel,
  previewId,
  previewFocusable = false,
}: ToolWorkspaceLayoutProps) {
  const previewScrollRef = useRef<HTMLDivElement>(null);

  // The preview only scrolls on desktop. When the viewport shrinks to mobile, clear any
  // retained desktop scroll offset so the in-flow preview never starts part-way down.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
    const reset = () => {
      if (!query.matches && previewScrollRef.current) {
        previewScrollRef.current.scrollTop = 0;
      }
    };
    reset();
    query.addEventListener?.('change', reset);
    return () => query.removeEventListener?.('change', reset);
  }, []);

  return (
    <div
      className="relative grid w-full grid-cols-1 bg-page transition-colors duration-300 md:grid-cols-[30rem_minmax(0,1fr)] md:grid-rows-[auto_1fr]"
      data-testid="tool-workspace"
    >
      <aside
        aria-label={controlsLabel}
        className="relative z-10 flex min-w-0 flex-col border-line bg-surface transition-colors duration-300 md:col-start-1 md:row-start-1 md:border-r"
      >
        <div className="z-20 border-b border-line-subtle bg-surface transition-colors duration-300 md:sticky md:top-0">
          {header}
        </div>
        <div className="space-y-8 p-4 sm:p-6">
          <PanelErrorBoundary>{controls}</PanelErrorBoundary>
        </div>
      </aside>

      <section
        id={previewId}
        aria-label={previewLabel}
        className="relative min-w-0 md:col-start-2 md:row-span-2 md:row-start-1"
      >
        <div
          ref={previewScrollRef}
          className="relative flex flex-col items-center p-4 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:px-8 md:py-6"
          data-testid="tool-workspace-preview-scroller"
          // A preview without controls (a canvas) must still be scrollable from the keyboard,
          // so it becomes a named, focusable group.
          role={previewFocusable ? 'group' : undefined}
          aria-label={previewFocusable ? `${previewLabel}, scrollable` : undefined}
          tabIndex={previewFocusable ? 0 : undefined}
        >
          {/* Decorative glow, clipped so it never widens the page or creates a scroll area. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-clip opacity-40 dark:opacity-20">
            <div className="absolute top-0 left-0 size-96 -translate-1/2 rounded-full bg-accent-line blur-3xl transition-colors duration-300"></div>
            <div className="absolute right-0 bottom-0 size-96 translate-1/2 rounded-full bg-line blur-3xl transition-colors duration-300"></div>
          </div>
          <div className="relative z-10 w-full max-w-md lg:max-w-xl xl:max-w-2xl">
            <PanelErrorBoundary>{preview}</PanelErrorBoundary>
          </div>
        </div>
      </section>

      {secondary && (
        <div className="min-w-0 border-line bg-surface transition-colors duration-300 md:col-start-1 md:row-start-2 md:border-r">
          <div className="space-y-8 p-4 pb-12 sm:p-6 sm:pb-12">
            <PanelErrorBoundary>{secondary}</PanelErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Props for {@link ToolWorkspaceHeader}.
 */
export interface ToolWorkspaceHeaderProps {
  /** Page heading text (rendered as the page's only h1). */
  title: string;
  /** Short description under the heading. */
  subtitle: string;
  /** Optional pill shown after the subtitle, e.g. "Beta". */
  badge?: string;
  /** Optional mode switcher control rendered under the heading. */
  modeSwitcher?: React.ReactNode;
  /** Tool actions shown beside the heading (for example a help link). */
  actions?: React.ReactNode;
  /** Id of the preview region; renders a mobile-only "Jump to preview" link when set. */
  previewId?: string;
  /** Label of the mobile jump link. */
  previewJumpLabel?: string;
}

/**
 * Header shared by every tool workspace: page heading, tool actions and, on mobile, a jump
 * link to the preview. Site navigation and the theme toggle live in the app shell header.
 * @param props - Header content.
 * @param props.title - Page heading text.
 * @param props.subtitle - Description under the heading.
 * @param props.badge - Optional pill after the subtitle.
 * @param props.modeSwitcher - Optional mode switcher control.
 * @param props.actions - Extra header actions.
 * @param props.previewId - DOM id of the preview region.
 * @param props.previewJumpLabel - Label of the mobile jump link.
 * @returns The workspace header.
 */
export function ToolWorkspaceHeader({
  title,
  subtitle,
  badge,
  modeSwitcher,
  actions,
  previewId,
  previewJumpLabel = 'Jump to preview',
}: ToolWorkspaceHeaderProps) {
  const previewHref = previewId ? `#${previewId}` : '';

  const renderPreviewJump = () => {
    if (!previewHref) return null;
    if (!isDangerousUrl(previewHref)) {
      return (
        <a
          href={previewHref}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-accent underline-offset-2 hover:underline md:hidden"
        >
          <Eye className="size-4" aria-hidden="true" />
          {previewJumpLabel}
        </a>
      );
    }
    return null;
  };

  return (
    <header className="flex items-start justify-between gap-2 p-4 sm:p-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-fg">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-fg-muted">{subtitle}</p>
          {badge && (
            <Badge tone="beta">{badge}</Badge>
          )}
        </div>
        {modeSwitcher && <div className="mt-3 flex items-center">{modeSwitcher}</div>}
        {renderPreviewJump()}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
