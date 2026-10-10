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

import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';
import { useTheme } from '@/context/ThemeContext';
import { type ThemePreference, nextThemePreference } from '@/utils/theme';

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Builds the toggle's accessible name: the current theme and what activating it does.
 * @param preference - The active preference.
 * @returns The label, e.g. "Theme: System. Switch to Light theme".
 */
export function getThemeToggleLabel(preference: ThemePreference): string {
  return `Theme: ${THEME_LABELS[preference]}. Switch to ${THEME_LABELS[nextThemePreference(preference)]} theme`;
}

/**
 * The one theme control used on every page. It cycles System, Light and Dark, and its
 * icon shows the current preference.
 * @param root0 - Component properties.
 * @param root0.className - Extra classes for placement.
 * @returns The theme toggle button.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { preference, cyclePreference } = useTheme();
  const Icon = THEME_ICONS[preference];
  const label = getThemeToggleLabel(preference);

  return (
    <Tooltip content={label} side="bottom">
      <Button
        variant="icon"
        iconOnly
        size="lg"
        shape="round"
        onClick={cyclePreference}
        className={className}
        aria-label={label}
        data-theme-preference={preference}
      >
        <Icon className="size-5" aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
