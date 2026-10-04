import { useEffect, useState, type ComponentType } from 'react';
import { isOpticalModemEnabled } from '@/packages/optical-modem/flag';

/**
 * The optical channel probe (#1162). It is a hand-held tool for measuring phones and is not linked
 * anywhere. The tool itself is a separate chunk that loads only when the build turns the flag on.
 */
export default function OpticalProbePage() {
  const enabled = isOpticalModemEnabled();
  const [App, setApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    void import('./ProbeApp').then((module) => {
      if (current) setApp(() => module.default);
    });
    return () => {
      current = false;
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold text-fg">Optical channel probe</h1>
        <p className="mt-4 text-fg-muted">This experimental tool is switched off in this build.</p>
      </main>
    );
  }
  return App ? <App /> : <p className="p-8 text-fg-muted">Loading the probe...</p>;
}
