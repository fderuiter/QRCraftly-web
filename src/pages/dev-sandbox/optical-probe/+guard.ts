import { render } from 'vike/abort';
import { isOpticalModemEnabled } from '@/packages/optical-modem/flag';

/**
 * Replaces the sandbox guard, which answers 404 in every production build. The probe is served by
 * a production build only when that build turns on `VITE_OPTICAL_MODEM` (#1619); otherwise it
 * answers 404 like the rest of the sandbox, including on a client-side navigation.
 */
export const guard = (): void => {
  if (import.meta.env.PROD && !isOpticalModemEnabled()) {
    throw render(404, 'The optical probe is switched off in this build.');
  }
};
