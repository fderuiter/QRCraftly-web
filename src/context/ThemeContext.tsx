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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
  applyThemeToDocument,
  nextThemePreference,
  parseThemePreference,
  readStoredThemePreference,
  resolveTheme,
  systemPrefersDark,
  writeStoredThemePreference,
} from '@/utils/theme';

/**
 * Public theme API shared by every page.
 */
export interface ThemeContextValue {
  /** The visitor's chosen preference (`light`, `dark` or `system`). */
  preference: ThemePreference;
  /** The theme currently applied after resolving `system`. */
  resolvedTheme: ResolvedTheme;
  /** Sets and persists a preference. */
  setPreference: (preference: ThemePreference) => void;
  /** Advances to the next preference in the toggle cycle. */
  cyclePreference: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Global theme provider mounted once in the default layout, above every route, so the
 * theme survives client-side navigation. The pre-hydration script in `<head>` already
 * applied the stored theme; this provider takes over after mount without re-applying
 * a default first (which would flash the wrong theme).
 * @param root0 - Component properties.
 * @param root0.children - The application tree.
 * @returns The provider element.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemDark, setSystemDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreferenceState(readStoredThemePreference());
    setSystemDark(systemPrefersDark());
    setReady(true);

    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setPreferenceState(parseThemePreference(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);

    let media: MediaQueryList | undefined;
    const onSchemeChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia(DARK_SCHEME_QUERY);
      media.addEventListener?.('change', onSchemeChange);
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      media?.removeEventListener?.('change', onSchemeChange);
    };
  }, []);

  const resolvedTheme = resolveTheme(preference, systemDark);

  useEffect(() => {
    if (ready) applyThemeToDocument(resolvedTheme);
  }, [ready, resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeStoredThemePreference(next);
  }, []);

  const cyclePreference = useCallback(() => {
    setPreference(nextThemePreference(preference));
  }, [preference, setPreference]);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference, cyclePreference }),
    [preference, resolvedTheme, setPreference, cyclePreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const noop = () => {};
const FALLBACK_THEME: ThemeContextValue = {
  preference: 'system',
  resolvedTheme: 'light',
  setPreference: noop,
  cyclePreference: noop,
};

/**
 * Reads the global theme. Outside a provider (isolated unit tests) it returns an inert
 * light theme so components still render.
 * @returns The theme API.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK_THEME;
}
