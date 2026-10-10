import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { ScannabilityIndicator } from './ScannabilityIndicator';

describe('ScannabilityIndicator Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows one green verdict with a meter for a clean print-simulation pass', () => {
    render(<ScannabilityIndicator status="physical-pass" health={{ score: 100, warnings: [] }} />);

    const pill = screen.getByTestId('scannability-pill');
    expect(screen.getByTestId('scannability-verdict')).toHaveTextContent('Scans reliably');
    expect(pill).toHaveClass('text-success');
    expect(screen.getByTestId('scannability-meter')).toHaveTextContent('100');
    expect(pill).toHaveAccessibleName('Scans reliably, health score 100 of 100');
  });

  it.each([
    ['physical-pass', 95, [], 'Scans reliably', 'text-success'],
    ['physical-pass', 90, [], 'Scans reliably', 'text-success'],
    ['physical-pass', 89, [], 'Scans, but fragile', 'text-warning'],
    ['physical-pass', 95, ['Contrast ratio is low'], 'Scans, but fragile', 'text-warning'],
    ['digital-pass', 100, [], 'Scans, but fragile', 'text-warning'],
    ['digital-pass', 60, [], 'Scans, but fragile', 'text-warning'],
    ['fail', 95, [], "Won't scan reliably", 'text-danger'],
    ['fail', 30, ['Contrast ratio is critically low'], "Won't scan reliably", 'text-danger'],
  ] as const)('maps %s with score %i and warnings %j to "%s"', (status, score, warnings, label, tone) => {
    render(<ScannabilityIndicator status={status} health={{ score, warnings: [...warnings] }} />);
    expect(screen.getByTestId('scannability-verdict')).toHaveTextContent(label);
    expect(screen.getByTestId('scannability-pill')).toHaveClass(tone);
  });

  it('never says "verified", whatever the state', () => {
    for (const status of ['physical-pass', 'digital-pass', 'fail'] as const) {
      const { container, unmount } = render(<ScannabilityIndicator status={status} health={{ score: 73, warnings: ['Local contrast drop detected across 4 module zones'] }} />);
      expect(container.textContent).not.toMatch(/verified/i);
      unmount();
    }
  });

  it('explains the top issue in plain words and offers a fix in the details panel', () => {
    const onFix = vi.fn();
    render(
      <ScannabilityIndicator
        status="physical-pass"
        health={{ score: 73, warnings: ['Local contrast drop detected across 4 module zones'] }}
        errorCorrectionLevel="M"
        onFix={onFix}
      />
    );

    const pill = screen.getByTestId('scannability-pill');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(pill);
    expect(pill).toHaveAttribute('aria-expanded', 'true');

    const details = screen.getByTestId('scannability-details');
    expect(details).toHaveTextContent('Print simulation: passed');
    expect(screen.getByTestId('scannability-advice')).toHaveTextContent('Some modules blur together when printed');
    expect(details.textContent).not.toMatch(/module zone/);

    fireEvent.click(screen.getByRole('button', { name: 'Use high error correction' }));
    expect(onFix).toHaveBeenCalledWith('raise-error-correction');
    expect(screen.queryByTestId('scannability-details')).not.toBeInTheDocument();
  });

  it('suggests a bolder pattern when error correction is already high', () => {
    render(
      <ScannabilityIndicator
        status="physical-pass"
        health={{ score: 73, warnings: ['Local contrast drop detected across 4 module zones'] }}
        errorCorrectionLevel="H"
        onFix={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('scannability-pill'));
    expect(screen.getByRole('button', { name: 'Use the standard pattern' })).toBeInTheDocument();
  });

  it('closes the details panel on Escape and returns focus to the pill', () => {
    render(<ScannabilityIndicator status="digital-pass" health={{ score: 85, warnings: [] }} />);
    const pill = screen.getByTestId('scannability-pill');
    fireEvent.click(pill);
    expect(screen.getByTestId('scannability-details')).toHaveTextContent('test with a phone camera before printing');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('scannability-details')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(pill);
  });

  it('debounces screen reader announcements by 1000ms', () => {
    const { rerender } = render(<ScannabilityIndicator status="checking" />);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion.textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(liveRegion.textContent).toBe('');

    rerender(<ScannabilityIndicator status="physical-pass" health={{ score: 95, warnings: [] }} />);
    expect(liveRegion.textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(liveRegion.textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(liveRegion.textContent).toBe('Scannability: Scans reliably. Health score: 95 of 100.');
  });

  it('does not register a global Alt+S shortcut', () => {
    render(<ScannabilityIndicator status="physical-pass" health={{ score: 100, warnings: [] }} />);
    const event = new KeyboardEvent('keydown', { key: 's', altKey: true, bubbles: true, cancelable: true });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps exactly one polite status region and one silent alert region, including while idle', () => {
    const { rerender } = render(<ScannabilityIndicator status="idle" />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    rerender(<ScannabilityIndicator status="checking" />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });

  it('does not re-announce a failure while a re-check of a still-failing design runs', () => {
    const failing = { score: 40, warnings: ['Contrast ratio is low'] };
    const { rerender } = render(<ScannabilityIndicator status="fail" health={failing} />);
    const alert = screen.getByRole('alert');
    const message = alert.textContent;
    expect(message).toMatch(/Won't scan reliably/);

    rerender(<ScannabilityIndicator status="checking" />);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toBe(message);

    rerender(<ScannabilityIndicator status="fail" health={failing} />);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toBe(message);

    rerender(<ScannabilityIndicator status="physical-pass" health={{ score: 100, warnings: [] }} />);
    expect(alert.textContent).toBe('');
  });

  it('announces a failure once through a single alert, not through the polite region', () => {
    const { rerender } = render(<ScannabilityIndicator status="checking" />);
    rerender(<ScannabilityIndicator status="fail" health={{ score: 40, warnings: ['Contrast ratio is low'] }} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Won't scan reliably. The colours are a little close.");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status').textContent).toBe('');
    // The visible pill carries no live role of its own.
    expect(screen.getByTestId('scannability-pill')).not.toHaveAttribute('role');
  });

  it('still raises an alert for a failure without warnings', () => {
    render(<ScannabilityIndicator status="fail" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/camera could not read this design/i);
  });

  it('raises the alert for a critical warning even when the camera check passed', () => {
    const { rerender } = render(<ScannabilityIndicator status="checking" />);
    rerender(
      <ScannabilityIndicator status="physical-pass" health={{ score: 60, warnings: [], criticalWarnings: ['Contrast ratio is too low'] }} />,
    );

    expect(screen.getByTestId('scannability-verdict')).toHaveTextContent("Won't scan reliably");
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Announced once, by the alert; the polite region stays silent.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('does not raise an alert for a fragile pass', () => {
    render(<ScannabilityIndicator status="digital-pass" health={{ score: 85, warnings: ['Contrast ratio is low'] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });

  it('has no axe violations in pass, fail and open-panel states', async () => {
    vi.useRealTimers();
    const { container, rerender } = render(<ScannabilityIndicator status="physical-pass" health={{ score: 100, warnings: [] }} />);
    expect(await axe(container)).toHaveNoViolations();
    rerender(<ScannabilityIndicator status="fail" health={{ score: 30, warnings: ['Contrast ratio is critically low'] }} onFix={vi.fn()} onResetDefault={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByTestId('scannability-pill'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers a fix and a colour reset when the design will not scan', () => {
    const onFix = vi.fn();
    const onReset = vi.fn();

    render(
      <ScannabilityIndicator
        status="fail"
        health={{ score: 30, warnings: ['Contrast ratio is critically low'] }}
        onFix={onFix}
        onResetDefault={onReset}
      />
    );
    fireEvent.click(screen.getByTestId('scannability-pill'));
    fireEvent.click(screen.getByRole('button', { name: 'Use black on white' }));
    expect(onFix).toHaveBeenCalledWith('increase-contrast');

    fireEvent.click(screen.getByTestId('scannability-pill'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset colours' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('offers no actions for a reliable design or without callbacks', () => {
    const { rerender } = render(<ScannabilityIndicator status="fail" health={{ score: 30, warnings: ['Contrast ratio is low'] }} />);
    fireEvent.click(screen.getByTestId('scannability-pill'));
    expect(screen.queryByTestId('scannability-recovery-actions')).not.toBeInTheDocument();

    rerender(<ScannabilityIndicator status="physical-pass" health={{ score: 100, warnings: [] }} onFix={vi.fn()} onResetDefault={vi.fn()} />);
    expect(screen.queryByTestId('scannability-recovery-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scannability-advice')).not.toBeInTheDocument();
  });
});
