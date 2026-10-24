// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { combineIds, announcePolitely } from './a11y';

describe('a11y - Accessibility Helpers', () => {
  describe('combineIds', () => {
    it('combines truthy ids', () => {
      expect(combineIds('id1', 'id2')).toBe('id1 id2');
    });

    it('filters out falsy values like undefined, null, false, empty strings', () => {
      expect(combineIds('id1', undefined, 'id2', null, false, '', 'id3')).toBe('id1 id2 id3');
    });

    it('returns undefined if all values are falsy or no arguments provided', () => {
      expect(combineIds()).toBeUndefined();
      expect(combineIds(undefined, null, false, '')).toBeUndefined();
    });
  });

  describe('announcePolitely', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      const el = document.getElementById('dynamic-focus-live-region');
      if (el) el.remove();
    });

    afterEach(() => {
      vi.useRealTimers();
      const el = document.getElementById('dynamic-focus-live-region');
      if (el) el.remove();
    });

    it('creates a visually hidden live region and populates the announcement message after a short delay', () => {
      announcePolitely('Test polite announcement');

      const liveRegion = document.getElementById('dynamic-focus-live-region');
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
      expect(liveRegion?.getAttribute('role')).toBe('status');
      expect(liveRegion?.className).toContain('sr-only');

      // It should clear the text first immediately
      expect(liveRegion?.textContent).toBe('');

      // After advancing timers, it should have the message
      vi.advanceTimersByTime(50);
      expect(liveRegion?.textContent).toBe('Test polite announcement');
    });

    it('reuses the existing live region element if already present', () => {
      // Call first time to create
      announcePolitely('First announcement');
      vi.advanceTimersByTime(50);
      const firstEl = document.getElementById('dynamic-focus-live-region');

      // Call second time
      announcePolitely('Second announcement');
      const secondEl = document.getElementById('dynamic-focus-live-region');

      expect(firstEl).toBe(secondEl); // Should be the exact same element reference

      vi.advanceTimersByTime(50);
      expect(secondEl?.textContent).toBe('Second announcement');
    });
  });
});
