/**
 * Replaces the sandbox guard, which answers 404 in production builds. The probe decides for itself
 * with the `VITE_OPTICAL_MODEM` flag and renders a notice when it is off.
 */
export const guard = (): void => undefined;
