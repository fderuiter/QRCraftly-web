import { useEffect, useRef } from 'react';
import { announcePolitely } from '../utils/a11y';

/**
 * Helper to retrieve all form fields (inputs, selects, textareas) inside a container.
 */
function getFormFields(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )
  );
}

/**
 * Check if two arrays of HTML elements have exactly the same elements.
 */
function areElementsEqual(arr1: HTMLElement[], arr2: HTMLElement[]): boolean {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    const el1 = arr1[i];
    const el2 = arr2[i];
    const matches = el1 === el2 || (el1.id && el2.id && el1.id === el2.id);
    if (!matches) return false;
  }
  return true;
}

/**
 * Get a clean name for a form element based on its label or attributes.
 */
function getElementName(element: HTMLElement): string {
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) {
      const text = label.textContent || '';
      // Clean up whitespace and remove any trailing "(Optional)" or similar parenthesized text
      const cleanText = text.replace(/\s+/g, ' ').replace(/\s*\([^)]*\)/g, '').trim();
      if (cleanText) return cleanText;
    }
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();

  const nameAttr = element.getAttribute('name');
  if (nameAttr) return nameAttr.trim();

  if (id) {
    return id.replace(/[-_]/g, ' ');
  }

  return 'input field';
}



/**
 * A standardized focus-management hook to eliminate manual re-navigation
 * and improve task completion speed for users with visual impairments.
 * Programmatically moves focus to the first interactive field of a newly rendered component.
 * @param _dependencies Array of dependencies (kept for backward compatibility, not used for re-binding)
 */
export function useDynamicFocus<T extends HTMLElement = HTMLDivElement>(_dependencies: readonly unknown[]) {
  const containerRef = useRef<T>(null);
  
  // Track if we've focused once on mount. Focus shifts must only occur 
  // during intentional user-triggered transitions.
  const isInitialMount = useRef(true);

  // Cache element names by element ID or unique signature so we can refer to them even after they unmount
  const elementNamesRef = useRef<Record<string, string>>({});

  // Track previous focusable elements across renders
  const prevElementsRef = useRef<HTMLElement[]>([]);

  // Track the last focused element inside the document to handle focus loss during unmount
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Set a timeout to clear the initial mount flag shortly after mounting
    const timeout = setTimeout(() => {
      isInitialMount.current = false;
    }, 150);

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target === document.body) {
        if (lastFocusedRef.current && (!lastFocusedRef.current.isConnected || !document.body.contains(lastFocusedRef.current))) {
          // Ignore this browser-default focus reset to preserve the unmounted element's reference
          return;
        }
      }
      lastFocusedRef.current = target;
    };

    document.addEventListener('focusin', handleFocusIn);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    // Track the initial list of focusable elements
    const initialElements = getFormFields(container);
    prevElementsRef.current = initialElements;

    // Save initial element names
    for (const el of initialElements) {
      if (el.id) {
        elementNamesRef.current[el.id] = getElementName(el);
      }
    }

    const observer = new MutationObserver(() => {
      const currentElements = getFormFields(container);
      const prevElements = prevElementsRef.current;

      // If the list of focusable elements has not changed, do nothing
      if (areElementsEqual(prevElements, currentElements)) {
        return;
      }

      // Skip the initial form load to prevent unexpected focus hijacking
      if (isInitialMount.current) {
        prevElementsRef.current = currentElements;
        return;
      }

      // Determine which elements were added or removed
      const addedElements = currentElements.filter(
        currEl => !prevElements.some(prevEl => prevEl === currEl || (currEl.id && prevEl.id === currEl.id))
      );

      const removedElements = prevElements.filter(
        prevEl => !currentElements.some(currEl => currEl === prevEl || (prevEl.id && currEl.id === prevEl.id))
      );

      // Cache names of any newly seen elements
      for (const el of currentElements) {
        if (el.id && !elementNamesRef.current[el.id]) {
          elementNamesRef.current[el.id] = getElementName(el);
        }
      }

      // Handle removed elements
      if (removedElements.length > 0) {
        const names = removedElements
          .map(el => elementNamesRef.current[el.id] || getElementName(el))
          .filter(Boolean);

        if (names.length > 0) {
          const message = names.join(' and ') + ' removed';
          announcePolitely(message);
        }

        // Shift focus if the focused element was removed
        const wasFocusedRemoved = removedElements.some(
          el => el === lastFocusedRef.current || (el.id && lastFocusedRef.current && el.id === lastFocusedRef.current.id)
        );

        if (wasFocusedRemoved) {
          const firstRemovedEl = removedElements[0];
          let prevIndex = prevElements.indexOf(firstRemovedEl);
          if (prevIndex === -1 && firstRemovedEl.id) {
            prevIndex = prevElements.findIndex(el => el.id === firstRemovedEl.id);
          }

          let targetElement: HTMLElement | null = null;
          if (prevIndex !== -1) {
            // Find nearest remaining interactive field after the removed one
            for (let i = prevIndex; i < currentElements.length; i++) {
              if (currentElements[i]) {
                targetElement = currentElements[i];
                break;
              }
            }
            // If none found after, find nearest remaining interactive field before
            if (!targetElement) {
              for (let i = prevIndex - 1; i >= 0; i--) {
                if (currentElements[i]) {
                  targetElement = currentElements[i];
                  break;
                }
              }
            }
          }

          if (targetElement) {
            const elToFocus = targetElement;
            elToFocus.focus();
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
              if (document.body.contains(elToFocus)) {
                elToFocus.focus();
              }
            });
          }
        }
      }

      // Handle added elements
      if (addedElements.length > 0) {
        const names = addedElements.map(el => getElementName(el)).filter(Boolean);
        if (names.length > 0) {
          const message = names.join(' and ') + ' field is now available';
          announcePolitely(message);
        }

        // Programmatically move focus directly to the first newly mounted field,
        // unless the user is actively typing in a remaining text input.
        const activeElement = document.activeElement as HTMLElement;
        const isUserTypingInTextInput = activeElement && 
          (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
          !['radio', 'checkbox', 'submit', 'button', 'image', 'reset', 'file'].includes((activeElement as HTMLInputElement).type || '');
        const isUserFocusingTab = activeElement && (
          activeElement.getAttribute('role') === 'tab' || 
          activeElement.closest('[role="tablist"]') !== null
        );

        // Only follow the user's own action inside the panel. A field that arrives on its own,
        // such as a lazily loaded form on a slow connection, must not pull focus from the site
        // menu or anywhere else the user has moved to (#1662).
        const lastFocused = lastFocusedRef.current;
        const isUserInPanel = activeElement && activeElement !== document.body
          ? container.contains(activeElement)
          : lastFocused !== null && (!lastFocused.isConnected || container.contains(lastFocused));

        if (isUserInPanel && !isUserTypingInTextInput && !isUserFocusingTab) {
          const firstNewElement = addedElements[0];
          firstNewElement.focus();
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            if (document.body.contains(firstNewElement)) {
              firstNewElement.focus();
            }
          });
        }
      }

      prevElementsRef.current = currentElements;
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []); // Run on mount once

  return containerRef;
}
