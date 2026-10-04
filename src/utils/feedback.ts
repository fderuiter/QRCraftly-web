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

/**
 * Whether the person asked for less motion. Haptics and animation stay off when they did.
 * @returns True under `prefers-reduced-motion: reduce`.
 */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Buzzes the device briefly where the browser supports it. Does nothing under reduced motion.
 * @param pattern - Vibration pattern in milliseconds.
 */
export function vibrate(pattern: number | number[]): void {
  if (reducedMotion() || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(pattern);
}

/**
 * Plays a short two-note chime made on the spot with Web Audio. No audio file is loaded. Callers
 * only use it after the person turned sound on.
 */
export function playChime(): void {
  const Context = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Context) return;
  try {
    const ctx = new Context();
    const start = ctx.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, start + index * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.14 + 0.3);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + index * 0.14);
      oscillator.stop(start + index * 0.14 + 0.32);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    // Audio is a nicety; a blocked or missing audio device must never break a transfer.
  }
}
