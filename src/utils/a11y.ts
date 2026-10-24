export function combineIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const combined = ids.filter(Boolean).join(' ');
  return combined.length > 0 ? combined : undefined;
}

/**
 * Announce a message politely to screen readers using a visually hidden live region.
 */
export function announcePolitely(message: string) {
  if (typeof document === 'undefined') return;
  let liveRegion = document.getElementById('dynamic-focus-live-region');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'dynamic-focus-live-region';
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    // Ensure it is visually hidden
    liveRegion.style.position = 'absolute';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.padding = '0';
    liveRegion.style.margin = '-1px';
    liveRegion.style.overflow = 'hidden';
    liveRegion.style.clip = 'rect(0, 0, 0, 0)';
    liveRegion.style.whiteSpace = 'nowrap';
    liveRegion.style.borderWidth = '0';
    document.body.appendChild(liveRegion);
  }

  // Clear content first to trigger some assistive tech reliably
  liveRegion.textContent = '';
  setTimeout(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  }, 50);
}

