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

import { useEffect, useState } from 'react';

const TEXT_ENTRY = 'input, textarea, select';

/**
 * Whether a text field has focus, so the generator's mobile action bar and mini preview can step
 * aside while the on-screen keyboard is up and neither covers the field being typed in (WCAG 2.4.11).
 * @param insideRef - A region whose own fields do not count (the Download options sit inside the bar).
 */
export function useTextEntryFocus(insideRef: React.RefObject<HTMLElement | null>): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const update = () => setFocused(document.activeElement instanceof Element && document.activeElement.matches(TEXT_ENTRY) && !insideRef.current?.contains(document.activeElement));
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, [insideRef]);
  return focused;
}
