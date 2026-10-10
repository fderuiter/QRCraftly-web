/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { type RefObject, useEffect, useRef } from 'react';

/**
 * Options for {@link usePopoverDismiss}.
 */
interface PopoverDismissOptions {
  /** Whether the popup is currently open. */
  open: boolean;
  /** Element containing both the trigger and the popup. */
  containerRef: RefObject<HTMLElement | null>;
  /** Trigger that receives focus back after Escape. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Closes the popup. */
  onClose: () => void;
}

/**
 * Shared dismissal behaviour for popups (menus and disclosure navigation):
 * - Escape closes the popup and returns focus to its trigger;
 * - a pointer press outside the container closes it without moving focus;
 * - focus leaving the container (for example with Tab) closes it.
 * @param options - Popup state, refs and close callback.
 */
export function usePopoverDismiss({ open, containerRef, triggerRef, onClose }: PopoverDismissOptions): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
      triggerRef.current?.focus();
    };

    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && container?.contains(target)) return;
      onCloseRef.current();
    };

    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container?.contains(next)) return;
      // relatedTarget is null when focus leaves the document or goes to a non-focusable
      // area (a pointer press elsewhere); the pointer handler covers that case.
      if (next === null) return;
      onCloseRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    container?.addEventListener('focusout', onFocusOut);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      container?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, containerRef, triggerRef]);
}
