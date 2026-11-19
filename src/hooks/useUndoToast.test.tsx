import React from 'react';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { useUndoToast } from './useUndoToast';

describe('useUndoToast hook (WCAG 2.2 SC 2.2.1 Timing Adjustable & SC 4.1.3 Status Messages)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const TestUndoComponent = () => {
    const notifyUndo = useUndoToast();
    const store = useQRStore();

    return (
      <div>
        <button
          onClick={() => {
            store.updateConfig({ fgColor: '#123456' });
            notifyUndo('Style preset changed');
          }}
        >
          Change Style
        </button>
      </div>
    );
  };

  it('does nothing when called outside QRProvider', () => {
    const StandaloneComponent = () => {
      const notifyUndo = useUndoToast();
      return <button onClick={() => notifyUndo('Standalone change')}>Trigger</button>;
    };

    render(
      <ToastProvider>
        <StandaloneComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Trigger'));
    expect(screen.queryByText('Standalone change')).not.toBeInTheDocument();
  });

  it('dispatches a persistent undo toast that does not auto-dismiss on a timer', () => {
    const { container } = render(
      <QRProvider>
        <ToastProvider>
          <TestUndoComponent />
        </ToastProvider>
      </QRProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Change Style'));
    });

    const politeRegion = container.querySelector('[aria-live="polite"]');
    expect(politeRegion).toBeInTheDocument();

    // Verify message is rendered inside the polite live region (SC 4.1.3)
    expect(within(politeRegion as HTMLElement).getByText('Style preset changed')).toBeInTheDocument();
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    expect(undoButton).toBeInTheDocument();

    // Advance time beyond previous 8000ms limit to verify persistent timing (SC 2.2.1)
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Style preset changed')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText('Style preset changed')).toBeInTheDocument();
  });

  it('triggers store undo and closes notification when Undo button is clicked', () => {
    render(
      <QRProvider>
        <ToastProvider>
          <TestUndoComponent />
        </ToastProvider>
      </QRProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText('Change Style'));
    });

    const undoButton = screen.getByRole('button', { name: 'Undo' });
    act(() => {
      fireEvent.click(undoButton);
      vi.advanceTimersByTime(300);
    });

    // Toast is dismissed following action
    expect(screen.queryByText('Style preset changed')).not.toBeInTheDocument();
  });

  it('can be dismissed at any time using the close button or Escape key', () => {
    render(
      <QRProvider>
        <ToastProvider>
          <TestUndoComponent />
        </ToastProvider>
      </QRProvider>
    );

    const changeBtn = screen.getByText('Change Style');
    changeBtn.focus();
    act(() => {
      fireEvent.click(changeBtn);
    });

    expect(screen.getByText('Style preset changed')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close notification' });
    act(() => {
      closeBtn.focus();
    });

    act(() => {
      fireEvent.keyDown(closeBtn, { key: 'Escape' });
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByText('Style preset changed')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(changeBtn);
  });
});
