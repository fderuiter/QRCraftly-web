import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const TestComponent = () => {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast({ type: 'success', message: 'Test message' })}>
      Show Toast
    </button>
  );
};

describe('Toast Timing and Interactive Controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should dismiss automatically after default 5000ms if no user interaction', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    // Trigger toast
    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Advance time by 4999ms - should still be there
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Advance 1ms more -> 5000ms total - should be removed
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should pause dismissal when hovered and resume when unhovered', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');
    expect(toastElement).toBeInTheDocument();

    // Hover after 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(toastElement!);

    // Advance by 10000ms while hovered - toast should still exist
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Unhover
    fireEvent.mouseLeave(toastElement!);

    // Since it resets to a full 5000ms, it should stay for 4999ms more
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // After 5000ms it should be gone
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should pause dismissal when focused and resume when unfocused', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');
    expect(toastElement).toBeInTheDocument();

    // Focus after 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.focus(toastElement!);

    // Advance by 10000ms while focused - toast should still exist
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Blur
    fireEvent.blur(toastElement!);

    // Since it resets to a full 5000ms, it should stay for 4999ms more
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // After 5000ms it should be gone
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should not resume dismissal if hover leaves but focus is still active', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');

    // Both hover and focus
    fireEvent.mouseEnter(toastElement!);
    fireEvent.focus(toastElement!);

    // Leave hover
    fireEvent.mouseLeave(toastElement!);

    // Advance 10000ms - still there because focused
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Leave focus
    fireEvent.blur(toastElement!);

    // Now it should start the full 5000ms countdown
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should immediately dismiss when close button is clicked even while paused', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');
    expect(toastElement).toBeInTheDocument();

    // Hover to pause
    fireEvent.mouseEnter(toastElement!);

    // Click close button
    const closeBtn = screen.getByLabelText('Close notification');
    fireEvent.click(closeBtn);

    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should support focusing elements inside the toast and blur properly', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');
    const closeBtn = screen.getByLabelText('Close notification');

    // Focus the close button (internal element)
    fireEvent.focus(closeBtn);

    // This bubbles up to the container's onFocus, setting isFocused to true.
    // Advance timers - should not dismiss
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Blur the close button to another element inside the toast (e.g. the toast container itself)
    fireEvent.blur(closeBtn, { relatedTarget: toastElement });

    // This should NOT set isFocused to false because relatedTarget is inside the toast container.
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    // Now blur to body (outside the toast)
    fireEvent.blur(toastElement!, { relatedTarget: document.body });

    // Now it should reset the timer to a full 5000ms
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('Test message')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });

  it('should render toast container with symmetric mobile layout classes', () => {
    const { container } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));

    const toastContainer = container.querySelector('div.fixed');
    expect(toastContainer).toBeInTheDocument();
    expect(toastContainer?.className).toContain('bottom-4');
    expect(toastContainer?.className).toMatch(/inset-x-4|left-4/);
    expect(toastContainer?.className).toContain('md:left-auto');
    expect(toastContainer?.className).toContain('md:right-4');
    expect(toastContainer?.className).toContain('md:bottom-4');
  });

  it('should immediately dismiss toast when pressing Escape key on focused notification', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    const toastElement = screen.getByText('Test message').closest('[role="status"]');
    expect(toastElement).toBeInTheDocument();

    // Focus toast item
    fireEvent.focus(toastElement!);

    // Press Escape
    fireEvent.keyDown(toastElement!, { key: 'Escape' });

    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
  });
});
