import type { QRConfig } from '../types';
import { LOW_RELIABILITY_PATTERNS, MIN_CONTRAST_THRESHOLD, PATTERNS, PRESET_COLORS } from '../constants';
import { getContrastRatio } from './colorUtils';

/** The settings a gallery tile or "Surprise me" changes. */
export type StyleChoice = Pick<QRConfig, 'style' | 'fgColor' | 'bgColor' | 'eyeColor'>;

/** Scan outlook shown by the dot on a gallery tile. */
export type StyleScanTone = 'good' | 'check';

/**
 * Estimates, without decoding anything, whether a look is likely to scan: the modules and the
 * corner eyes need enough contrast against the background, and the few complex patterns
 * need a test print. The live scan check on the preview stays the authority.
 * @param choice - Pattern and colours of the look.
 * @returns `good` when contrast and pattern raise no concern, otherwise `check`.
 */
export function styleScanTone(choice: StyleChoice): StyleScanTone {
  const bg = choice.bgColor === 'transparent' ? '#ffffff' : choice.bgColor;
  const contrast = Math.min(getContrastRatio(choice.fgColor, bg), getContrastRatio(choice.eyeColor, bg));
  return contrast >= MIN_CONTRAST_THRESHOLD && !LOW_RELIABILITY_PATTERNS.includes(choice.style) ? 'good' : 'check';
}

/**
 * Picks a random look that is expected to scan: a pattern without a scan concern and a
 * colour preset with enough contrast. It avoids repeating the current look when another exists.
 * @param random - Source of numbers in [0, 1); pass `Math.random` or a seeded generator.
 * @param current - The look on screen, which the pick differs from when possible.
 * @returns Pattern and colours to apply.
 */
export function surpriseStyle(random: () => number, current?: StyleChoice): StyleChoice {
  const choices: StyleChoice[] = [];
  for (const { id: style } of PATTERNS) {
    for (const preset of PRESET_COLORS) {
      const choice = { style, fgColor: preset.fg, bgColor: preset.bg, eyeColor: preset.eye };
      if (styleScanTone(choice) === 'good') choices.push(choice);
    }
  }
  const differing = current
    ? choices.filter((c) => c.style !== current.style || c.fgColor !== current.fgColor || c.bgColor !== current.bgColor || c.eyeColor !== current.eyeColor)
    : choices;
  const pool = differing.length > 0 ? differing : choices;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
