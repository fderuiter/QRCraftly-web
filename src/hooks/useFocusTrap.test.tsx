import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

function Trap({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref}>
      <button type="button">Inside</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup() {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const opener = document.createElement('button');
    opener.textContent = 'Opener';
    const other = document.createElement('button');
    other.textContent = 'Other';
    document.body.append(opener, other);
    opener.focus();
    const flush = () => act(() => frames.splice(0).forEach((cb) => cb(0)));
    return { opener, other, flush };
  }

  it('returns focus to the element focused before it opened', () => {
    const { opener, flush } = setup();
    const { rerender } = render(<Trap active />);
    flush();
    expect(document.activeElement?.textContent).toBe('Inside');
    rerender(<Trap active={false} />);
    flush();
    expect(document.activeElement).toBe(opener);
  });

  it('does not take focus back from an element focused on purpose after closing', () => {
    const { other, flush } = setup();
    const { rerender } = render(<Trap active />);
    flush();
    rerender(<Trap active={false} />);
    // Another component moves focus before the next frame (as the site menu does with its button).
    other.focus();
    flush();
    expect(document.activeElement).toBe(other);
  });

  it('bypasses hidden interactive elements when focusing the first element upon opening', () => {
    const { flush } = setup();
    function TrapWithHiddenFirst({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" hidden>Hidden 1</button>
          <div hidden>
            <button type="button">Hidden inside container</button>
          </div>
          <button type="button" style={{ display: 'none' }}>Hidden 3</button>
          <button type="button">First Visible</button>
          <button type="button">Second Visible</button>
        </div>
      );
    }

    render(<TrapWithHiddenFirst active />);
    flush();
    expect(document.activeElement?.textContent).toBe('First Visible');
  });

  it('excludes elements with hidden attribute from Tab traversal sequence', () => {
    const { flush } = setup();
    function TrapHidden({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="b1">Button 1</button>
          <div hidden>
            <button type="button" data-testid="b-hidden-sub">Hidden Sub</button>
          </div>
          <button type="button" hidden data-testid="b-hidden-direct">Hidden Direct</button>
          <button type="button" data-testid="b2">Button 2</button>
        </div>
      );
    }

    const { getByTestId } = render(<TrapHidden active />);
    flush();
    const b1 = getByTestId('b1');
    const b2 = getByTestId('b2');

    expect(document.activeElement).toBe(b1);

    // Tab forward
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b2);

    // Tab wraps around
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b1);

    // Shift+Tab backward wraps around
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b2);
  });

  it('excludes elements inside inert containers from Tab traversal sequence', () => {
    const { flush } = setup();
    function TrapInert({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="b1">Button 1</button>
          <div inert>
            <button type="button" data-testid="b-inert">Inert Button</button>
          </div>
          <button type="button" data-testid="b2">Button 2</button>
        </div>
      );
    }

    const { getByTestId } = render(<TrapInert active />);
    flush();
    const b1 = getByTestId('b1');
    const b2 = getByTestId('b2');

    expect(document.activeElement).toBe(b1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b2);
  });

  it('excludes elements with aria-hidden="true" from Tab traversal sequence', () => {
    const { flush } = setup();
    function TrapAriaHidden({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="b1">Button 1</button>
          <div aria-hidden="true">
            <button type="button" data-testid="b-aria-hidden-child">Aria Hidden Child</button>
          </div>
          <button type="button" aria-hidden="true" data-testid="b-aria-hidden-self">Aria Hidden Self</button>
          <button type="button" data-testid="b2">Button 2</button>
        </div>
      );
    }

    const { getByTestId } = render(<TrapAriaHidden active />);
    flush();
    const b1 = getByTestId('b1');
    const b2 = getByTestId('b2');

    expect(document.activeElement).toBe(b1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b2);
  });

  it('excludes elements hidden via CSS display or visibility rules', () => {
    const { flush } = setup();
    function TrapCssHidden({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="b1">Button 1</button>
          <div style={{ display: 'none' }}>
            <button type="button" data-testid="b-display-none">Display None Child</button>
          </div>
          <div style={{ visibility: 'hidden' }}>
            <button type="button" data-testid="b-visibility-hidden">Visibility Hidden Child</button>
          </div>
          <button type="button" data-testid="b2">Button 2</button>
        </div>
      );
    }

    const { getByTestId } = render(<TrapCssHidden active />);
    flush();
    const b1 = getByTestId('b1');
    const b2 = getByTestId('b2');

    expect(document.activeElement).toBe(b1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(b2);
  });

  it('dynamically updates traversal sequence immediately when collapsible content toggles', () => {
    const { flush } = setup();
    function TrapCollapsible({ active, isOpen }: { active: boolean; isOpen: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="toggle-btn">Toggle</button>
          <div hidden={!isOpen} data-testid="panel">
            <input data-testid="panel-input" placeholder="Panel input" />
            <button type="button" data-testid="panel-action">Panel action</button>
          </div>
          <button type="button" data-testid="submit-btn">Submit</button>
        </div>
      );
    }

    // 1. Initially collapsed
    const { getByTestId, rerender } = render(<TrapCollapsible active isOpen={false} />);
    flush();
    const toggleBtn = getByTestId('toggle-btn');
    const submitBtn = getByTestId('submit-btn');

    expect(document.activeElement).toBe(toggleBtn);

    // Tab jumps directly from toggle button to submit button (bypassing collapsed content)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(submitBtn);

    // 2. Expand accordion/disclosure
    rerender(<TrapCollapsible active isOpen={true} />);
    flush();
    const panelInput = getByTestId('panel-input');
    const panelAction = getByTestId('panel-action');

    // Move focus back to toggle button
    toggleBtn.focus();
    expect(document.activeElement).toBe(toggleBtn);

    // Tab now immediately enters revealed disclosure panel
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(panelInput);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(panelAction);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(submitBtn);

    // 3. Collapse accordion again
    rerender(<TrapCollapsible active isOpen={false} />);
    flush();

    toggleBtn.focus();
    expect(document.activeElement).toBe(toggleBtn);

    // Tab skips panel controls again
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(submitBtn);
  });

  it('re-routes focus to the next visible focusable element if current focus was inside a collapsed section', () => {
    const { flush } = setup();
    function TrapCollapsing({ active, isOpen }: { active: boolean; isOpen: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, active);
      return (
        <div ref={ref}>
          <button type="button" data-testid="header-btn">Header</button>
          <div hidden={!isOpen}>
            <button type="button" data-testid="inner-btn">Inner</button>
          </div>
          <button type="button" data-testid="footer-btn">Footer</button>
        </div>
      );
    }

    const { getByTestId, rerender } = render(<TrapCollapsing active isOpen={true} />);
    flush();
    const innerBtn = getByTestId('inner-btn');
    const footerBtn = getByTestId('footer-btn');

    innerBtn.focus();
    expect(document.activeElement).toBe(innerBtn);

    // Section collapses while innerBtn had focus
    rerender(<TrapCollapsing active isOpen={false} />);
    flush();

    // Tab presses while focus is on now-hidden inner element
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    flush();
    expect(document.activeElement).toBe(footerBtn);
  });
});
