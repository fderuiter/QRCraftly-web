import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LadderPreview from './LadderPreview';

// The real encoder, simulator and decoder take seconds; this test is about the replay and the display.
vi.mock('@/packages/optical-modem', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/packages/optical-modem')>();
  return {
    ...original,
    encodeModemFrame: vi.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })),
    simulateCapture: vi.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })),
    decodeModemFrame: vi.fn((_image: unknown, options?: { geometries?: { cols: number }[] }) => {
      const cols = options?.geometries?.[0]?.cols ?? 0;
      const profile = cols === 104 ? 2 : cols === 120 ? 3 : 4;
      // This receiver reads P2 and P3 completely and repairs nothing of P4.
      return { ok: true, header: { profile, packetBytes: 80 }, blocks: new Array(10).fill(null), blocksOk: profile === 4 ? 0 : 10, erasures: 0, corrected: 0 };
    }),
  };
});

describe('LadderPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prepares captures, then updates the link display once a second and says it is a simulation', async () => {
    render(<LadderPreview />);
    expect(screen.getByRole('heading', { name: /link display \(simulated\)/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing here is a measurement of a phone/i)).toBeInTheDocument();
    expect(screen.queryByTestId('optical-link-display')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start the simulated link/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/making simulated captures/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId('optical-link-display')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('optical-lock-level')).toHaveTextContent('Locked P3');
    expect(screen.getByTestId('optical-link-label')).toHaveTextContent(/^Optical link: 8-colour · 120×67 · 30 Hz/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('optical-link-advice')).toHaveTextContent(/move closer/i);
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
    expect(screen.getByRole('button', { name: /start the simulated link/i })).toBeEnabled();
  });
});
