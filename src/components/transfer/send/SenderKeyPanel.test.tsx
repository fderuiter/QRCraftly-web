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
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { AUTO_HIDE_MS, SenderKeyPanel, type SenderKeyPanelProps } from './SenderKeyPanel';

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

describe('SenderKeyPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('toggles the words on click and exposes dynamic aria-expanded', async () => {
    const { container } = renderPanel();
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(screen.getByTestId('sender-key-code-hidden')).toBeInTheDocument();

    const codeBtn = screen.getByRole('button', { name: 'Show key code' });
    expect(codeBtn).toHaveAttribute('aria-expanded', 'false');
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(codeBtn);
    expect(screen.getByTestId('sender-key-code')).toHaveTextContent('baba dede');
    const hideBtn = screen.getByRole('button', { name: 'Hide key code' });
    expect(hideBtn).toHaveAttribute('aria-expanded', 'true');
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(hideBtn);
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show key code' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles the key QR on click and calls props handlers', async () => {
    const { container, props } = renderPanel();
    const qrBtn = screen.getByRole('button', { name: 'Show key QR' });
    expect(qrBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(qrBtn);
    expect(props.onShowKeyQr).toHaveBeenCalledTimes(1);
    const hideQrBtn = screen.getByRole('button', { name: 'Hide key QR' });
    expect(hideQrBtn).toHaveAttribute('aria-expanded', 'true');
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(hideQrBtn);
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Show key QR' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('automatically hides the key code after thirty seconds', () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show key code' }));
    expect(screen.getByTestId('sender-key-code')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS - 1);
    });
    expect(screen.getByTestId('sender-key-code')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show key code' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('automatically hides the key QR after thirty seconds', () => {
    vi.useFakeTimers();
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show key QR' }));
    expect(props.onShowKeyQr).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Show key QR' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears the auto-hide timer when manually toggled off', () => {
    vi.useFakeTimers();
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Show key code' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hide key code' }));
    expect(screen.queryByTestId('sender-key-code')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(screen.queryByTestId('sender-key-code')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show key QR' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hide key QR' }));
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(AUTO_HIDE_MS);
    });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });

  it('ends reveals when the window loses focus', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show key code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show key QR' }));
    expect(screen.getByTestId('sender-key-code')).toBeInTheDocument();
    expect(props.onShowKeyQr).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Show key code' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Show key QR' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('ends the reveal when the page is hidden, and not while it stays visible', () => {
    const { props } = renderPanel();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Show key QR' }));

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

  it('stops listening for window blur once nothing is revealed', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show key QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide key QR' }));
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(props.onHideKeyQr).toHaveBeenCalledTimes(1);
  });
});
