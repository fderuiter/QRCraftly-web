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

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { DEFAULT_CONFIG } from '@/constants';
import { QRErrorCorrectionLevel } from '@/types';
import MockupView from './MockupView';
import { MOCKUP_SCENES } from './scenes';
import { PREVIEW_VIEWS } from './previewViews';

const testViewingConditions = vi.hoisted(() => vi.fn());
vi.mock('../../utils/viewingConditions', () => ({ testViewingConditions }));

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function sourceCanvas(): React.RefObject<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  canvas.toDataURL = vi.fn(() => PNG);
  return { current: canvas };
}

const config = { ...DEFAULT_CONFIG, value: 'https://example.com', errorCorrectionLevel: QRErrorCorrectionLevel.M };

function renderView(view: Parameters<typeof MockupView>[0]['view'] = 'poster', moduleCount = 33) {
  const sourceRef = sourceCanvas();
  const result = render(<MockupView sourceRef={sourceRef} renderKey={1} config={config} moduleCount={moduleCount} view={view} />);
  return { ...result, sourceRef };
}

const reducedMotion = (reduce: boolean, coarse = false) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (reduce && query.includes('reduce')) || (coarse && query.includes('coarse')),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

describe('MockupView', () => {
  beforeEach(() => {
    reducedMotion(false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('offers a view for every scene, and the live code appears inside the scene', async () => {
    expect(PREVIEW_VIEWS.map((view) => view.value)).toEqual(['flat', ...MOCKUP_SCENES.map((scene) => scene.id)]);
    expect(MOCKUP_SCENES.length).toBeGreaterThanOrEqual(4);
    renderView('poster');
    const scene = screen.getByRole('img', { name: /framed poster/i });
    await waitFor(() => expect(within(scene as unknown as HTMLElement).getByTestId('mockup-qr')).toHaveAttribute('href', PNG));
  });

  it.each(MOCKUP_SCENES.map((scene) => scene.id))('draws the %s scene from code alone: no outside image, font or link', async (id) => {
    const { container } = renderView(id);
    await waitFor(() => expect(screen.getByTestId('mockup-qr')).toBeInTheDocument());
    const svg = container.querySelector('svg') as SVGSVGElement;
    const references = Array.from(svg.querySelectorAll('[href], [src]')).map((element) => element.getAttribute('href') ?? element.getAttribute('src') ?? '');
    expect(references.every((reference) => reference.startsWith('data:'))).toBe(true);
    expect(svg.outerHTML).not.toMatch(/https?:\/\//i);
    expect(svg.querySelector('image, foreignObject, style, script')?.tagName).not.toMatch(/foreignObject|style|script/i);
  });

  it('shows the module size and the scan distance for the printed width, and updates them with the slider', () => {
    renderView('poster', 33);
    const guidance = screen.getByTestId('mockup-guidance');
    expect(guidance).toHaveTextContent('2.0 m');
    fireEvent.change(screen.getByLabelText('Printed width'), { target: { value: '10' } });
    expect(guidance).toHaveTextContent('1.0 m');
  });

  it('warns when the printed size is too small for the content and says how big it must be', () => {
    renderView('card', 97);
    fireEvent.change(screen.getByLabelText('Printed width'), { target: { value: '1.5' } });
    const warning = screen.getByRole('alert');
    expect(warning).toHaveTextContent('Too small for this content');
    expect(warning).toHaveTextContent(/at least \d+\.\d cm wide/);
    fireEvent.change(screen.getByLabelText('Printed width'), { target: { value: '6' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts a screen scene in terms of the screen, with no printed size', () => {
    renderView('screen');
    expect(screen.queryByLabelText('Printed width')).not.toBeInTheDocument();
    expect(screen.getByText(/brightness is up/)).toBeInTheDocument();
  });

  it('runs the viewing test on the live code and shows pass or fail for each condition', async () => {
    testViewingConditions.mockResolvedValue([
      { id: 'as-designed', label: 'As designed', passed: true },
      { id: 'distance-300', label: 'From 3.0 m away', passed: false },
      { id: 'glare', label: 'Glare across the print', passed: null },
    ]);
    const { sourceRef } = renderView('poster');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test real-world conditions' }));
    });
    expect(testViewingConditions).toHaveBeenCalledWith(sourceRef.current, config, 33, 20);
    const results = screen.getByTestId('viewing-results');
    expect(within(results).getByText('As designed').closest('li')).toHaveTextContent('Still scans');
    expect(within(results).getByText('From 3.0 m away').closest('li')).toHaveTextContent('Fails to scan');
    expect(within(results).getByText('Glare across the print').closest('li')).toHaveTextContent('Could not check');
  });

  it('forgets the results once the size changes, since they described another size', async () => {
    testViewingConditions.mockResolvedValue([{ id: 'as-designed', label: 'As designed', passed: true }]);
    renderView('poster');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test real-world conditions' }));
    });
    expect(screen.getByTestId('viewing-results')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Printed width'), { target: { value: '30' } });
    expect(screen.queryByTestId('viewing-results')).not.toBeInTheDocument();
  });

  it('leaves the export disabled until the code has been copied into the scene', async () => {
    renderView('poster');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download mockup PNG' })).toBeEnabled());
  });

  it('moves with the pointer on desktop, and not at all under reduced motion', async () => {
    const { container, unmount } = renderView('poster');
    expect(screen.getByRole('switch', { name: 'Move with the pointer' })).toBeChecked();
    const stage = container.querySelector('svg')!.parentElement as HTMLElement;
    const nearLayer = () => container.querySelector('[data-layer="front"]')?.getAttribute('transform');
    expect(nearLayer()).toBe('translate(0 0)');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => {
      fireEvent.pointerMove(stage, { clientX: 100, clientY: 50, pointerType: 'mouse' });
    });
    expect(nearLayer()).toBe('translate(10 0)');
    unmount();

    reducedMotion(true);
    renderView('poster');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('keeps motion off by default on a phone until it is switched on', () => {
    reducedMotion(false, true);
    renderView('poster');
    const toggle = screen.getByRole('switch', { name: 'Move with my phone' });
    expect(toggle).not.toBeChecked();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderView('poster');
    await waitFor(() => expect(screen.getByTestId('mockup-qr')).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
