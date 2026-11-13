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

// @vitest-environment jsdom
// The key panel's hold (#1698): the words and the key QR share one rule, shown only while held.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { SenderKeyPanel, type SenderKeyPanelProps } from './SenderKeyPanel';

/** Renders the panel with spy handlers. */
function renderPanel(overrides: Partial<SenderKeyPanelProps> = {}) {
  const props: SenderKeyPanelProps = {
    keyCode: 'baba dede fifi gogo kuku lala mimi nono',
    showingKeyQr: false,
    keyCanvasRef: { current: null },
    onShowKeyQr: vi.fn(),
    onHideKeyQr: vi.fn(),
    ...overrides,
  };
  return { ...render(<SenderKeyPanel {...props} />), props };
}

const qrButton = () => screen.getByRole('button', { name: 'Hold to show key QR' });
const wordsButton = () => screen.getByRole('button', { name: 'Hold to show key code' });

describe('SenderKeyPanel', () => {
  it('shows the words only while their button is held', async () => {
    const { container } = renderPanel();
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    fireEvent.pointerDown(wordsButton());
    expect(screen.getByTestId('sender-key-code')).toHaveTextContent('baba dede');
    fireEvent.pointerUp(wordsButton());
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ['pointer up', (el: HTMLElement) => fireEvent.pointerUp(el)],
    ['pointer leave', (el: HTMLElement) => fireEvent.pointerLeave(el)],
    ['pointer cancel', (el: HTMLElement) => fireEvent.pointerCancel(el)],
    ['blur', (el: HTMLElement) => fireEvent.blur(el)],
  ])('ends the key QR hold on %s', (_name, release) => {
    const { props } = renderPanel();
    fireEvent.pointerDown(qrButton());
    expect(props.onShowKeyQr).toHaveBeenCalledTimes(1);
    release(qrButton());
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });

  it('holds with Space or Enter, ignores key repeat, and ends on key up', () => {
    const { props } = renderPanel();
    fireEvent.keyDown(qrButton(), { key: 'Enter' });
    fireEvent.keyDown(qrButton(), { key: 'Enter', repeat: true });
    expect(props.onShowKeyQr).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(qrButton(), { key: 'Enter' });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });

  it('ends both holds when the window loses focus, before the key QR has even arrived', () => {
    const { props } = renderPanel();
    fireEvent.pointerDown(wordsButton());
    fireEvent.pointerDown(qrButton());
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });

  it('ends the hold when the page is hidden, and not while it stays visible', () => {
    const { props } = renderPanel();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent.pointerDown(qrButton());
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(props.onHideKeyQr).not.toHaveBeenCalled();
    visibility.mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('stops listening for window blur once nothing is held', () => {
    const { props } = renderPanel();
    fireEvent.pointerDown(qrButton());
    fireEvent.pointerUp(qrButton());
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });
});
