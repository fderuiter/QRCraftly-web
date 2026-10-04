/**
 * The switch for everything experimental in QRCraftly Optical. It is off unless the build sets
 * `VITE_OPTICAL_MODEM=true`, so the modem, the probe page and the GPU path stay out of every normal
 * build. This entry point is deliberately tiny: pages import it statically, and it must not pull
 * any of the modem into a page's first load.
 */

/** Where the flag is read from; tests pass their own. */
export interface OpticalFlagSource {
  viteValue: string | undefined;
  nodeValue: string | undefined;
}

/**
 * Whether the experimental optical modem is enabled in this build.
 * @param source - Override for tests; by default Vite's build-time env, then the Node env for scripts.
 * @returns True only when the value is exactly `true`.
 */
export function isOpticalModemEnabled(source?: OpticalFlagSource): boolean {
  let viteValue = source?.viteValue;
  if (!source) {
    try {
      viteValue = import.meta.env.VITE_OPTICAL_MODEM;
    } catch {
      // Native Node runtimes expose import.meta without Vite's env object.
    }
  }
  const nodeValue = source ? source.nodeValue : typeof process !== 'undefined' ? process.env?.VITE_OPTICAL_MODEM : undefined;
  return (viteValue ?? nodeValue) === 'true';
}
