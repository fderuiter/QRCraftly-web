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

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QRProvider } from '@/context/QRContext';
import { QRErrorCorrectionLevel, QRType } from '@/types';
import { clearStagedArcadeTarget, stageArcadeTarget } from '@/packages/arcade/handoff';
import { ArcadeApp } from './ArcadeApp';

vi.mock('vike/client/router', () => ({ navigate: vi.fn(() => Promise.resolve()) }));

const ARENA_RECT = { left: 0, top: 0, width: 600, height: 720, right: 600, bottom: 720, x: 0, y: 0, toJSON: () => ({}) };
const BOARD_RECT = { ...ARENA_RECT, width: 512, height: 512, right: 512, bottom: 512 };

function stubMatchMedia(matches: (query: string) => boolean) {
  const lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  window.matchMedia = vi.fn((query: string) => {
    if (!lists.has(query)) lists.set(query, { matches: matches(query), listeners: new Set() });
    const entry = lists.get(query)!;
    return {
      get matches() {
        return entry.matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => entry.listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => entry.listeners.delete(cb),
    } as unknown as MediaQueryList;
  });
  return (query: string, value: boolean) => {
    const entry = lists.get(query);
    if (!entry) return;
    entry.matches = value;
    entry.listeners.forEach((cb) => cb());
  };
}

function stubDetector(values: string[][]) {
  const detect = vi.fn(async () => (values.length > 1 ? values.shift()! : values[0]).map((rawValue) => ({ rawValue })));
  (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
    detect = detect;
  };
  return detect;
}

/**
 * A lightweight 2D context: the shared jsdom canvas mock records every painted pixel, which is
 * far too slow for a 60 FPS game loop. Rendering is not asserted here, only observable state.
 */
function fastContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = {
    canvas,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(target, {
    get: (obj, key) => (key in obj ? obj[key] : () => undefined),
    set: (obj, key, value) => {
      obj[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/arcade');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return fastContext(this);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  // Default scanner: a detector that decodes nothing (tests that need a verdict override it).
  stubDetector([[]]);
  clearStagedArcadeTarget();
  stubMatchMedia(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLCanvasElement) {
    return (this.dataset.testid === 'arcade-simulator-canvas' ? BOARD_RECT : ARENA_RECT) as DOMRect;
  });
});

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.restoreAllMocks();
});

const payloadField = () => screen.getByLabelText('Target QR content') as HTMLInputElement;

describe('Arcade hub: modes and generator sync (#922)', () => {
  it('switches between Arcade Blaster and Damage Simulator tabs and keeps ?mode= in sync', () => {
    render(<ArcadeApp />);
    const tabs = screen.getByRole('tablist', { name: 'Arcade mode' });
    const blaster = within(tabs).getByRole('tab', { name: 'Arcade Blaster' });
    const simulator = within(tabs).getByRole('tab', { name: 'Damage Simulator' });
    expect(blaster).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('arcade-blaster-canvas')).toBeInTheDocument();

    fireEvent.click(simulator);
    expect(simulator).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('?mode=simulator');
    expect(screen.getByTestId('arcade-simulator-canvas')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', simulator.id);

    // Arrow keys move between tabs (roving tab stop).
    fireEvent.keyDown(simulator, { key: 'ArrowLeft' });
    expect(blaster).toHaveAttribute('aria-selected', 'true');
    expect(blaster).toHaveFocus();
    expect(window.location.search).toBe('?mode=blaster');
  });

  it('opens the mode named in the URL', () => {
    window.history.replaceState(null, '', '/arcade?mode=simulator');
    render(<ArcadeApp />);
    expect(screen.getByRole('tab', { name: 'Damage Simulator' })).toHaveAttribute('aria-selected', 'true');
  });

  it('inherits the active generator configuration from QRContext', () => {
    render(
      <QRProvider initialConfig={{ type: QRType.TEXT, value: 'Generator payload', errorCorrectionLevel: QRErrorCorrectionLevel.M, fgColor: '#123456' }}>
        <ArcadeApp />
      </QRProvider>
    );
    expect(payloadField().value).toBe('Generator payload');
    expect(screen.getByRole('radio', { name: /Level M/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('inherits a design staged by "Stress Test in Arcade" and resets back to it', () => {
    stageArcadeTarget({ payload: 'Staged design', ecc: 'L', fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' });
    render(<ArcadeApp />);
    expect(payloadField().value).toBe('Staged design');

    fireEvent.change(payloadField(), { target: { value: 'Experiment' } });
    fireEvent.click(screen.getByRole('radio', { name: /Level H/ }));
    expect(payloadField().value).toBe('Experiment');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Generator QR' }));
    expect(payloadField().value).toBe('Staged design');
    expect(screen.getByRole('radio', { name: /Level L/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('arcade-announcer')).toHaveTextContent('Target reset to the generator QR.');
  });

  it('falls back to high-contrast defaults without a generator design', () => {
    render(<ArcadeApp />);
    expect(payloadField().value).toMatch(/^https?:\/\//);
    expect(screen.getByRole('radio', { name: /Level H/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Secret text' }));
    expect(payloadField().value).toBe('PROMO_CODE_BLASTED_SURVIVAL');
  });
});

describe('Matrix fallback state propagation', () => {
  it('surfaces validation error, settings callout, and HUD fallback badge for empty or unencodable input and recovers when valid', () => {
    render(<ArcadeApp />);
    expect(screen.queryByTestId('arcade-fallback-callout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('arcade-hud-fallback-badge')).not.toBeInTheDocument();

    // Set empty input
    fireEvent.change(payloadField(), { target: { value: '' } });

    expect(payloadField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Payload cannot be encoded in a QR code. Showing default target.')).toBeInTheDocument();
    expect(screen.getByTestId('arcade-fallback-callout')).toHaveTextContent('https://qrcraftly.com');
    expect(screen.getByTestId('arcade-hud-fallback-badge')).toHaveTextContent('https://qrcraftly.com');

    // Input recovery: set valid text
    fireEvent.change(payloadField(), { target: { value: 'https://example.com' } });

    expect(payloadField()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByTestId('arcade-fallback-callout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('arcade-hud-fallback-badge')).not.toBeInTheDocument();
  });

  it('triggers fallback UI when payload exceeds QR capacity', () => {
    render(<ArcadeApp />);
    const oversizedPayload = 'X'.repeat(5000);
    fireEvent.change(payloadField(), { target: { value: oversizedPayload } });

    expect(payloadField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('arcade-fallback-callout')).toBeInTheDocument();
    expect(screen.getByTestId('arcade-hud-fallback-badge')).toBeInTheDocument();
  });
});

describe('Arcade Blaster (#923)', () => {
  const arsenal = () => screen.getByRole('radiogroup', { name: 'Blaster weapons' });

  it('selects weapons with buttons and the 1, 2, 3 shortcuts', () => {
    render(<ArcadeApp />);
    expect(within(arsenal()).getByRole('radio', { name: 'Plasma Blaster' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(arsenal()).getByRole('radio', { name: 'Antimatter Rocket' }));
    expect(within(arsenal()).getByRole('radio', { name: 'Antimatter Rocket' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(window, { key: '2' });
    expect(within(arsenal()).getByRole('radio', { name: 'Thermal Laser' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('arcade-announcer')).toHaveTextContent('Thermal Laser equipped.');
    fireEvent.keyDown(window, { key: '1' });
    expect(within(arsenal()).getByRole('radio', { name: 'Plasma Blaster' })).toHaveAttribute('aria-checked', 'true');

    // Shortcuts are ignored while typing.
    fireEvent.keyDown(payloadField(), { key: '3' });
    expect(within(arsenal()).getByRole('radio', { name: 'Plasma Blaster' })).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles rapid auto-fire', () => {
    render(<ArcadeApp />);
    const toggle = screen.getByRole('switch', { name: 'Rapid Auto-Fire (plasma)' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('chips micro-cells under the laser, updates counts, and heals', async () => {
    render(<ArcadeApp />);
    const canvas = screen.getByTestId('arcade-blaster-canvas');
    expect(canvas).toHaveStyle({ touchAction: 'none' });
    const [intactBefore, total] = screen.getByTestId('arcade-intact').textContent!.split(' / ').map(Number);
    expect(intactBefore).toBe(total);
    expect(screen.getByTestId('arcade-blasted')).toHaveTextContent('0');

    fireEvent.keyDown(window, { key: '2' });
    // Aim at the top-left finder (always dark) and hold the laser.
    fireEvent.pointerDown(canvas, { clientX: 104, clientY: 64, pointerId: 1, button: 0, pointerType: 'mouse' });
    await waitFor(() => expect(Number(screen.getByTestId('arcade-blasted').textContent)).toBeGreaterThan(0), { timeout: 3000 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    const blasted = Number(screen.getByTestId('arcade-blasted').textContent);
    const intactAfter = Number(screen.getByTestId('arcade-intact').textContent!.split(' / ')[0]);
    expect(intactAfter + blasted).toBe(total);
    expect(Number(screen.getByTestId('arcade-durability').textContent!.replace('%', ''))).toBe(Math.round((intactAfter / total) * 100));

    fireEvent.click(screen.getByRole('button', { name: 'Heal QR Code' }));
    expect(screen.getByTestId('arcade-blasted')).toHaveTextContent('0');
    expect(screen.getByTestId('arcade-durability')).toHaveTextContent('100%');
  });

  it('fires plasma bolts with Space that collide with the target', async () => {
    render(<ArcadeApp />);
    const canvas = screen.getByTestId('arcade-blaster-canvas');
    fireEvent.pointerMove(canvas, { clientX: 104, clientY: 64 });
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    await waitFor(() => expect(Number(screen.getByTestId('arcade-blasted').textContent)).toBe(1), { timeout: 4000 });
  });
});

describe('Damage Simulator (#924)', () => {
  const openSimulator = () => {
    window.history.replaceState(null, '', '/arcade?mode=simulator');
    stageArcadeTarget({ payload: 'ARCADE', ecc: 'H', fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' });
    render(<ArcadeApp />);
    return screen.getByTestId('arcade-simulator-canvas');
  };
  const destroyed = () => Number(screen.getByTestId('arcade-damaged-modules').textContent!.split(' / ')[0]);

  it('strikes modules with the selected weapon radius', () => {
    const canvas = openSimulator();
    const arsenal = screen.getByRole('radiogroup', { name: 'Blast weapon' });
    fireEvent.pointerDown(canvas, { clientX: 256, clientY: 256, pointerId: 1, button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(destroyed()).toBe(1);

    fireEvent.click(within(arsenal).getByRole('radio', { name: /Plasma Charge/ }));
    expect(within(arsenal).getByRole('radio', { name: /Plasma Charge/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 400, pointerId: 1, button: 0, pointerType: 'mouse' });
    expect(destroyed()).toBe(10);

    // Dragging keeps striking along the path.
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 300, pointerId: 1 });
    expect(destroyed()).toBeGreaterThan(10);
    fireEvent.pointerUp(canvas, { pointerId: 1 });
  });

  it('launches an artillery barrage and resets the grid', () => {
    openSimulator();
    const reset = screen.getByRole('button', { name: 'Reset Grid' });
    expect(reset).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Artillery Barrage' }));
    expect(destroyed()).toBeGreaterThan(0);
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(destroyed()).toBe(0);
  });

  it('takes the finder subsystem offline past 20% damage and offers a rebuild', async () => {
    const canvas = openSimulator();
    const board = BOARD_RECT.width;
    const size = 21;
    const cell = board / size;
    // Pinpoint strikes on 10 of the 49 top-left finder modules (20.4%).
    for (let i = 0; i < 10; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      fireEvent.pointerDown(canvas, { clientX: (col + 0.5) * cell, clientY: (row + 0.5) * cell, pointerId: 1, button: 0, pointerType: 'mouse' });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }
    expect(screen.getByTestId('arcade-health-percent')).toHaveTextContent('0%');
    const dialog = await screen.findByRole('dialog', { name: 'QR code defeated: Finder Subsystem Offline' });
    expect(within(dialog).getByTestId('arcade-defeat-diagnostic')).toHaveTextContent(/finder pattern/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Rebuild / Try Again' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(destroyed()).toBe(0);
    expect(screen.getByTestId('arcade-health-percent')).toHaveTextContent('100%');
  });

  it('strikes from the keyboard', () => {
    const canvas = openSimulator();
    canvas.focus();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: 'Enter' });
    expect(destroyed()).toBe(1);
  });
});

describe('Dual-layer scannability HUD (#925)', () => {
  it('shows SCANNABLE with the decoded payload from the native detector', async () => {
    stubDetector([['ARCADE']]);
    stageArcadeTarget({ payload: 'ARCADE', ecc: 'H', fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' });
    render(<ArcadeApp />);
    await waitFor(() => expect(screen.getByText('SCANNABLE')).toBeInTheDocument());
    expect(screen.getByTestId('arcade-readout')).toHaveTextContent('ARCADE');
    expect(screen.getByRole('meter', { name: 'Error correction health' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/native BarcodeDetector/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('arcade-announcer')).toHaveTextContent('Live scanner: scannable.'));
  });

  it('shows CORRUPTED with no data once the scanner fails, in either mode', async () => {
    const scanResults = [['ARCADE']];
    stubDetector(scanResults);
    window.history.replaceState(null, '', '/arcade?mode=simulator');
    stageArcadeTarget({ payload: 'ARCADE', ecc: 'H', fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' });
    render(<ArcadeApp />);
    await waitFor(() => expect(screen.getByText('SCANNABLE')).toBeInTheDocument());
    scanResults[0] = []; // the damaged board no longer decodes
    fireEvent.click(screen.getByRole('button', { name: 'Artillery Barrage' }));
    await waitFor(() => expect(screen.getByText('CORRUPTED / UNREADABLE')).toBeInTheDocument());
    expect(screen.getByTestId('arcade-readout')).toHaveTextContent('[No data decoded]');
  });
});

describe('Responsive ergonomics (#926)', () => {
  it('uses the stacked layout with a collapsible settings drawer below 1024px', () => {
    render(<ArcadeApp />);
    const layout = document.querySelector('[data-layout]')!;
    expect(layout).toHaveAttribute('data-layout', 'stacked');
    const drawerButton = screen.getByRole('button', { name: /Target settings & telemetry/ });
    const panel = screen.getByTestId('arcade-settings-panel');
    expect(drawerButton).toHaveAttribute('aria-expanded', 'false');
    expect(drawerButton).toHaveAttribute('aria-controls', panel.id);
    expect(panel.className).toMatch(/(^| )hidden( |$)/);
    fireEvent.click(drawerButton);
    expect(drawerButton).toHaveAttribute('aria-expanded', 'true');
    expect(panel.className).not.toMatch(/(^| )hidden( |$)/);
    // The quick weapon bar sits directly under the canvas, inside the arena pane.
    const arena = screen.getByRole('region', { name: 'Arena' });
    expect(within(arena).getByRole('radiogroup', { name: 'Weapon' })).toBeInTheDocument();
    expect(arena.firstElementChild?.querySelector('canvas')).not.toBeNull();
  });

  it('switches to the three-pane cockpit at 1024px and back', () => {
    const setMatch = stubMatchMedia((query) => query === '(min-width: 1024px)');
    render(<ArcadeApp />);
    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'cockpit');
    expect(screen.queryByRole('button', { name: /Target settings & telemetry/ })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Target and arsenal' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Live verification' })).toBeInTheDocument();

    act(() => setMatch('(min-width: 1024px)', false));
    expect(document.querySelector('[data-layout]')).toHaveAttribute('data-layout', 'stacked');
    expect(screen.getByRole('button', { name: /Target settings & telemetry/ })).toBeInTheDocument();
  });

  it('locks touch gestures on both arenas', () => {
    render(<ArcadeApp />);
    expect(screen.getByTestId('arcade-blaster-canvas').style.touchAction).toBe('none');
    fireEvent.click(screen.getByRole('tab', { name: 'Damage Simulator' }));
    expect(screen.getByTestId('arcade-simulator-canvas').style.touchAction).toBe('none');
  });
});
