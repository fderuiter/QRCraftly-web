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

import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useMediaQuery } from '@/packages/arcade/client';

/** Viewport width at which the three-pane cockpit replaces the stacked mobile layout. */
const COCKPIT_MEDIA_QUERY = '(min-width: 1024px)';

/** Properties for {@link ArcadeCockpit}. */
interface ArcadeCockpitProps {
  /** Target settings (left pane; mobile drawer). */
  settings: React.ReactNode;
  /** Full weapon arsenal with descriptions (left pane, desktop only). */
  arsenal: React.ReactNode;
  /** The canvas arena (centre pane; top of the page on mobile). */
  arena: React.ReactNode;
  /** Compact weapon bar directly under the canvas (mobile only). */
  quickBar: React.ReactNode;
  /** Keyboard and pointer hints under the canvas (desktop only). */
  hints: React.ReactNode;
  /** Dual-layer HUD (right pane; always visible). */
  hud: React.ReactNode;
  /** Quick actions such as heal or barrage (right pane). */
  actions: React.ReactNode;
  /** Detailed telemetry (right pane on desktop; inside the drawer on mobile). */
  telemetry: React.ReactNode;
}

/**
 * Responsive arcade layout.
 *
 * Below 1024px the arena is anchored first with a thumb-reachable weapon bar directly under
 * it, then the HUD and quick actions; target settings and telemetry sit in a collapsible
 * drawer at the bottom. From 1024px it becomes a three-pane cockpit: settings and arsenal on
 * the left, the arena in the centre, HUD, actions and telemetry on the right.
 * @param props - The pane contents.
 * @returns The layout.
 */
export function ArcadeCockpit({ settings, arsenal, arena, quickBar, hints, hud, actions, telemetry }: ArcadeCockpitProps) {
  const isDesktop = useMediaQuery(COCKPIT_MEDIA_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const settingsId = useId();

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const drawerClass = drawerOpen ? 'block' : 'hidden lg:block';

  return (
    <div
      data-layout={isDesktop ? 'cockpit' : 'stacked'}
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(15rem,19rem)] lg:gap-6"
    >
      <section aria-label="Arena" className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
        {arena}
        <div className="lg:hidden">{quickBar}</div>
        <div className="hidden lg:block">{hints}</div>
      </section>

      <aside aria-label="Live verification" className="min-w-0 space-y-4 lg:col-start-3 lg:row-start-1">
        {hud}
        {actions}
        <div className="hidden lg:block">{telemetry}</div>
      </aside>

      {!isDesktop && (
        <div className="lg:hidden">
          <Button
            variant="outline"
            fullWidth
            aria-expanded={drawerOpen}
            aria-controls={settingsId}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Target and stats
            <ChevronDown className={`size-4 transition-transform ${drawerOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      )}

      <aside
        id={settingsId}
        aria-label="Target and arsenal"
        className={`min-w-0 space-y-4 lg:col-start-1 lg:row-start-1 ${drawerClass}`}
        data-testid="arcade-settings-panel"
      >
        {settings}
        <div className="hidden lg:block">{arsenal}</div>
        <div className="lg:hidden">{telemetry}</div>
      </aside>
    </div>
  );
}
