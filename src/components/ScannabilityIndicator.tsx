import React, { useState, useEffect, useId, useRef } from 'react';
import { ShieldCheck, Loader2, ShieldAlert, ShieldX, Check, X } from 'lucide-react';
import type { ScannabilityStatus, HealthScore } from '../hooks/useScannability';
import { getScanVerdict, getScanAdvice, getScanChecks, type ScanVerdict, type ScanFix } from '@/packages/scannability';
import { Button } from './ui/Button';

interface Props {
  status: ScannabilityStatus;
  health?: HealthScore;
  /** The design's error correction level, so the suggested fix never repeats the current setting. */
  errorCorrectionLevel?: string;
  /** Applies a one-tap fix suggested for the top issue. */
  onFix?: (fix: ScanFix) => void;
  /** Restores the default colours; offered when the design will not scan. */
  onResetDefault?: () => void;
}

/** Visible verdict wording. "Verified" is never used: a pass with warnings is only "fragile". */
export const VERDICT_LABELS: Record<ScanVerdict, string> = {
  checking: 'Checking…',
  reliable: 'Scans reliably',
  fragile: 'Scans, but fragile',
  unreliable: "Won't scan reliably",
};

/** Icon, text and meter share one tone per verdict. */
const VERDICT_TONES: Record<ScanVerdict, string> = {
  checking: 'border-line bg-surface-raised text-fg-muted',
  reliable: 'border-success-line bg-success-soft text-success',
  fragile: 'border-warning-line bg-warning-soft text-warning',
  unreliable: 'border-danger-line bg-danger-soft text-danger',
};

const VERDICT_ICONS = {
  checking: Loader2,
  reliable: ShieldCheck,
  fragile: ShieldAlert,
  unreliable: ShieldX,
} as const;

const FIX_LABELS: Record<ScanFix, string> = {
  'raise-error-correction': 'Use high error correction',
  'increase-contrast': 'Use black on white',
  'standard-pattern': 'Use the standard pattern',
  'smaller-logo': 'Shrink the logo',
};

/**
 * Builds the polite screen reader announcement for routine updates.
 * @param verdict - The current verdict.
 * @param health - The optional health score.
 * @returns The announcement text.
 */
const getAnnouncementText = (verdict: ScanVerdict | null, health?: HealthScore): string => {
  if (!verdict) return '';
  if (verdict === 'checking') return 'Checking scannability...';
  const scorePart = health ? ` Health score: ${health.score} of 100.` : '';
  return `Scannability: ${VERDICT_LABELS[verdict]}.${scorePart}`;
};

/**
 * Small ring meter for the 0–100 health score, drawn in the current text colour.
 * @param root0 - Component properties.
 * @param root0.score - Health score from 0 to 100.
 * @returns The meter.
 */
function ScoreMeter({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 6;
  return (
    <span className="ml-0.5 inline-flex items-center gap-1" aria-hidden="true" data-testid="scannability-meter">
      <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
        />
      </svg>
      <span className="tabular-nums">{score}</span>
    </span>
  );
}

/**
 * Renders the scannability verdict: one pill whose icon, wording and score meter share a tone,
 * and a details panel (opened from the pill) that lists what was tested, explains the top issue
 * in plain words and offers a one-tap fix.
 *
 * Announcement model: routine updates go through one polite, debounced `role="status"` region;
 * a failure is rendered once in a `role="alert"` element so it is announced immediately and
 * exactly once. There is no global keyboard shortcut.
 * @param root0 - The props object.
 * @param root0.status - The current scannability status.
 * @param root0.health - The optional health score with warnings.
 * @param root0.errorCorrectionLevel - The design's error correction level.
 * @param root0.onFix - Applies a suggested fix.
 * @param root0.onResetDefault - Restores the default colours.
 * @returns The scannability feedback element.
 */
export const ScannabilityIndicator: React.FC<Props> = ({
  status,
  health,
  errorCorrectionLevel,
  onFix,
  onResetDefault,
}) => {
  const [announcement, setAnnouncement] = useState('');
  const [failureMessage, setFailureMessage] = useState('');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const verdict = getScanVerdict({ status, health });
  const advice = getScanAdvice({ status, health, errorCorrectionLevel });
  const fix = advice?.fix;
  // Any "won't scan" verdict is a failure, whether the camera check failed or a critical warning was raised.
  const isFailure = verdict === 'unreliable';

  // Debounce polite announcements by 1000ms so typing does not produce a stream of updates.
  // Failures are announced by the alert element below instead, never by this region.
  useEffect(() => {
    const text = isFailure ? '' : getAnnouncementText(verdict, health);
    setAnnouncement('');
    if (!text) return;
    const timer = setTimeout(() => setAnnouncement(text), 1000);
    return () => clearTimeout(timer);
  }, [isFailure, health, verdict]);

  // The failure alert keeps its text while a re-check runs, so a design that still fails is not
  // announced again on every edit; it changes only when a check settles on a different result.
  const failureText = isFailure
    ? `${VERDICT_LABELS.unreliable}. ${advice?.message ?? 'Adjust colours, pattern, or margin before exporting.'}`
    : '';
  useEffect(() => {
    if (verdict === 'checking') return;
    setFailureMessage(failureText);
  }, [verdict, failureText]);

  // Close the details panel on Escape (returning focus to the pill) or a press outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Both live regions stay mounted across every state, so screen readers track them reliably.
  const liveRegions = (
    <>
      <div className="sr-only" role="status" aria-live="polite" data-testid="scannability-status-region">
        {announcement}
      </div>
      <div className="sr-only" role="alert" data-testid="scannability-alert">
        {failureMessage}
      </div>
    </>
  );

  if (!verdict) {
    return (
      <div className="inline-block h-8 w-auto" data-testid="scannability-indicator-placeholder">
        {liveRegions}
      </div>
    );
  }

  const Icon = VERDICT_ICONS[verdict];
  const pillClasses = `flex h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap select-none motion-safe:transition-colors motion-safe:duration-300 ${VERDICT_TONES[verdict]}`;
  const pillContent = (
    <>
      <Icon className={`size-3.5 shrink-0 ${verdict === 'checking' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
      <span data-testid="scannability-verdict">{VERDICT_LABELS[verdict]}</span>
      {health && verdict !== 'checking' && (
        <>
          <ScoreMeter score={health.score} />
          <span className="sr-only">, health score {health.score} of 100</span>
        </>
      )}
    </>
  );

  return (
    <div ref={wrapperRef} className="relative h-8" data-testid="scannability-feedback-wrapper">
      {liveRegions}

      {verdict === 'checking' ? (
        <div className={pillClasses}>{pillContent}</div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={`${pillClasses} hover:brightness-95 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          data-testid="scannability-pill"
        >
          {pillContent}
        </button>
      )}

      {open && verdict !== 'checking' && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-40 mt-2 w-72 max-w-[calc(100vw_-_2rem)] rounded-xl border border-line bg-surface-raised p-4 text-left text-sm text-fg-soft shadow-overlay"
          data-testid="scannability-details"
        >
          <p className="font-semibold text-fg">{VERDICT_LABELS[verdict]}</p>
          {health && <p className="text-xs text-fg-muted">Health score {health.score} of 100</p>}
          <ul className="mt-3 space-y-1 text-xs">
            {getScanChecks(status).map((check) => (
              <li key={check.label} className="flex items-center gap-1.5">
                {check.passed ? (
                  <Check className="size-3.5 text-success" aria-hidden="true" />
                ) : (
                  <X className="size-3.5 text-danger" aria-hidden="true" />
                )}
                {check.label}: {check.passed ? 'passed' : 'did not pass'}
              </li>
            ))}
          </ul>
          {advice && <p className="mt-3" data-testid="scannability-advice">{advice.message}</p>}
          {((fix && onFix) || (verdict === 'unreliable' && onResetDefault)) && (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="scannability-recovery-actions">
              {fix && onFix && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onFix(fix);
                    setOpen(false);
                  }}
                >
                  {FIX_LABELS[fix]}
                </Button>
              )}
              {verdict === 'unreliable' && onResetDefault && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onResetDefault();
                    setOpen(false);
                  }}
                >
                  Reset colours
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
