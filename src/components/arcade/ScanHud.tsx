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

import { Eyebrow } from '@/components/ui/SectionHeading';
import React from 'react';
import { ShieldAlert, ShieldCheck, ScanLine, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { DamageAnalysis, FailureCause, healthTone, HealthTone } from '@/packages/arcade';
import type { EmpiricalState } from '@/packages/arcade/client';

const BAR_CLASSES: Record<HealthTone, string> = {
  healthy: 'bg-emerald-600 dark:bg-emerald-500',
  warning: 'bg-amber-500 dark:bg-amber-400',
  critical: 'bg-rose-600 motion-safe:animate-pulse dark:bg-rose-500',
};

const BADGE_CLASSES: Record<HealthTone, string> = {
  healthy: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  critical: 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
};

/** Headline for each failure cause. */
export const FAILURE_TITLES: Record<FailureCause, string> = {
  finder: 'Finder Subsystem Offline',
  block: 'Local Block Overflow',
  global: 'Global Budget Exhausted',
};

/**
 * Plain-language diagnostic for a failure.
 * @param failure - The cause.
 * @param analysis - The analysis it came from.
 * @returns The explanation.
 */
export function describeFailure(failure: FailureCause, analysis: DamageAnalysis): string {
  if (failure === 'finder') {
    return 'More than 20% of a 7×7 corner finder pattern is destroyed, so scanners cannot lock onto the grid, even though error correction budget remains.';
  }
  if (failure === 'block') {
    return `One interleaved Reed-Solomon block holds ${analysis.maxBlockDamage} damaged modules, more than its local budget of ${analysis.blockBudget}.`;
  }
  return `${analysis.damagedCount} damaged modules have used up the whole error correction budget of ${analysis.budget}.`;
}

/** Properties for {@link ScanHud}. */
interface ScanHudProps {
  /** Layer 1 analysis. */
  analysis: DamageAnalysis;
  /** Layer 2 verdict. */
  empirical: EmpiricalState;
  /** Whether a native BarcodeDetector is in use. */
  isNative: boolean;
  /** Whether the fallback payload was encoded because the requested payload failed. */
  usedFallback?: boolean;
}

/**
 * Dual-layer verification HUD: the analytical Reed-Solomon health bar and finder status
 * (Layer 1, updated synchronously on every damage event) beside the empirical scanner
 * verdict (Layer 2, from a real decoder).
 * @param props - HUD properties.
 * @returns The HUD card.
 */
export function ScanHud({ analysis, empirical, isNative, usedFallback }: ScanHudProps) {
  const tone = healthTone(analysis.healthPercent);
  const finderPercent = Math.round(analysis.worstFinderRatio * 100);

  return (
    <Card variant="control" className="space-y-5">
      <section aria-labelledby="arcade-hud-analytical">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="arcade-hud-analytical" className="text-sm font-bold text-fg">
            Reed-Solomon ECC health
          </h2>
          <span className={`rounded-md px-2 py-0.5 text-sm font-black tabular-nums ${BADGE_CLASSES[tone]}`} data-testid="arcade-health-percent">
            {analysis.healthPercent}%
          </span>
        </div>
        <div
          role="meter"
          aria-label="Error correction health"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={analysis.healthPercent}
          aria-valuetext={`${analysis.healthPercent}% error correction budget remaining`}
          className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        >
          <div className={`h-full rounded-full transition-[width] duration-150 ${BAR_CLASSES[tone]}`} data-tone={tone} style={{ width: `${analysis.healthPercent}%` }} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg-muted">
          <div>
            <dt>Damaged modules</dt>
            <dd className="font-bold text-fg tabular-nums" data-testid="arcade-damaged-modules">
              {analysis.damagedCount} / {analysis.budget}
            </dd>
          </div>
          <div>
            <dt>Worst block</dt>
            <dd className="font-bold text-fg tabular-nums">
              {analysis.maxBlockDamage} / {analysis.blockBudget}
            </dd>
          </div>
          <div className="col-span-2">
            <dt>Finder patterns</dt>
            <dd className={`font-bold ${analysis.isFinderOffline ? 'text-rose-700 dark:text-rose-300' : 'text-fg'}`}>
              {analysis.isFinderOffline ? 'Finder Subsystem Offline' : 'Aligned'} ({finderPercent}% worst damage, limit 20%)
            </dd>
          </div>
        </dl>
        {analysis.failure && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Subsystem failure: {FAILURE_TITLES[analysis.failure]}
            </span>
          </p>
        )}
        {!analysis.failure && tone === 'critical' && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Damage is close to the correction limit.</span>
          </p>
        )}
      </section>

      <section aria-labelledby="arcade-hud-empirical" className="border-t border-line pt-4">
        <h2 id="arcade-hud-empirical" className="mb-2 flex items-center gap-2 text-sm font-bold text-fg">
          <ScanLine className="size-4 text-accent" aria-hidden="true" />
          Live scanner
        </h2>
        <EmpiricalBadge state={empirical} />
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <Eyebrow>Live readout</Eyebrow>
          <p className="truncate font-mono text-xs font-semibold text-fg" data-testid="arcade-readout">
            {empirical.status === 'scannable' && empirical.decoded ? empirical.decoded : <span className="text-rose-700 italic dark:text-rose-300">[No data decoded]</span>}
          </p>
        </div>
        {usedFallback && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="arcade-hud-fallback-badge">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>
              Scanner reads fallback default address <code className="font-mono font-semibold">https://qrcraftly.com</code> because input payload failed to encode.
            </span>
          </p>
        )}
        <p className="mt-2 text-xs text-fg-muted">
          {isNative ? 'Decoded by the native BarcodeDetector.' : 'Decoded off-thread by the Scannability Worker.'} Frames are downscaled to 256×256 and never leave this device.
        </p>
      </section>
    </Card>
  );
}

function EmpiricalBadge({ state }: { state: EmpiricalState }) {
  if (state.status === 'scannable') {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-black tracking-widest text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" data-status="scannable">
        <ShieldCheck className="size-5 motion-safe:animate-pulse" aria-hidden="true" />
        SCANNABLE
      </p>
    );
  }
  if (state.status === 'corrupted') {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-black tracking-widest text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300" data-status="corrupted">
        <ShieldAlert className="size-5 motion-safe:animate-pulse" aria-hidden="true" />
        CORRUPTED / UNREADABLE
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-hover px-3 py-2 text-sm font-bold text-fg-soft" data-status={state.status}>
      <ScanLine className="size-5" aria-hidden="true" />
      {state.status === 'pending' ? 'Checking…' : 'Scanner unavailable'}
    </p>
  );
}
