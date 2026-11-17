import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Determines whether a candidate focusable element is visible and interactive.
 * Filters out elements that are hidden, inert, aria-hidden, or obscured via CSS.
 */
function isFocusableVisible(element: HTMLElement, container: HTMLElement): boolean {
  // Exclude elements that match :disabled (such as buttons inside a disabled fieldset)
  if (element.matches(':disabled')) {
    return false;
  }

  // Exclude elements inside inert containers or marked inert
  if (element.inert || element.closest('[inert]') !== null) {
    return false;
  }

  // Exclude elements with aria-hidden="true" or empty string on self or ancestor
  if (element.closest('[aria-hidden="true"], [aria-hidden=""]') !== null) {
    return false;
  }

  // Exclude elements with hidden attribute on self or ancestor
  if (element.hidden || element.closest('[hidden]') !== null) {
    return false;
  }

  // Modern browsers: evaluate CSS display and visibility rules natively
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ checkVisibilityCSS: true });
  }

  // Fallback for test environments without checkVisibility (such as jsdom)
  let current: HTMLElement | null = element;
  while (current && current !== container.parentElement) {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        return false;
      }
    }
    if (current.classList.contains('hidden')) {
      return false;
    }
    current = current.parentElement;
  }

  return true;
}

/**
 * Hook to trap keyboard focus within a container element.
 * Handles auto-focusing the first interactive element upon opening,
 * trapping focus during Tab / Shift+Tab navigation, and
 * restoring focus to the initiating element upon dismissal.
 * @param containerRef Ref pointing to the modal container element.
 * @param isActive Boolean indicating if the focus trap is active.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement;

    // Direct keyboard focus to the first interactive element inside the modal upon opening
    const focusFirst = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      const focusables = Array.from(currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => isFocusableVisible(el, currentContainer)
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    };

    focusFirst();
    const rafId = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const currentFocusables = Array.from(currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => isFocusableVisible(el, currentContainer)
      );
      if (currentFocusables.length === 0) return;

      const firstEl = currentFocusables[0];
      const lastEl = currentFocusables[currentFocusables.length - 1];
      const activeEl = document.activeElement as HTMLElement;

      // Programmatic traversal to guarantee consistent multi-browser behavior
      e.preventDefault();

      const currentIndex = currentFocusables.indexOf(activeEl);
      if (e.shiftKey) {
        const focusPrev = () => {
          if (currentIndex > 0) {
            currentFocusables[currentIndex - 1].focus();
          } else if (currentIndex === 0 || !activeEl || !currentContainer.contains(activeEl)) {
            lastEl.focus();
          } else {
            const prevEl = [...currentFocusables]
              .reverse()
              .find((el) => Boolean(activeEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) ?? lastEl;
            prevEl.focus();
          }
        };
        focusPrev();
        requestAnimationFrame(focusPrev);
      } else {
        const focusNext = () => {
          if (currentIndex >= 0 && currentIndex < currentFocusables.length - 1) {
            currentFocusables[currentIndex + 1].focus();
          } else if (currentIndex === currentFocusables.length - 1 || !activeEl || !currentContainer.contains(activeEl)) {
            firstEl.focus();
          } else {
            const nextEl = currentFocusables.find(
              (el) => Boolean(activeEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
            ) ?? firstEl;
            nextEl.focus();
          }
        };
        focusNext();
        requestAnimationFrame(focusNext);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
        // Retry once after paint for browsers that drop the first call, but never take focus
        // back from an element another component focused on purpose in the meantime.
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (active === null || active === document.body || container.contains(active)) {
            previouslyFocused.focus();
          }
        });
      }
    };
  }, [containerRef, isActive]);
}
