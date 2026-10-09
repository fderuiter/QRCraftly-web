import { useEffect } from 'react';

/**
 * Minimal slice of the ServiceWorkerContainer API used for registration,
 * so tests can pass a fake.
 */
export interface ServiceWorkerContainerLike {
  /** Worker controlling this page, or null on the first visit. */
  controller: unknown;
  /** Registers a service worker script. */
  register: (url: string) => Promise<ServiceWorkerRegistration>;
  /** Subscribes to controller changes. */
  addEventListener: (type: 'controllerchange', listener: () => void) => void;
  /** Unsubscribes from controller changes. */
  removeEventListener: (type: 'controllerchange', listener: () => void) => void;
}

/** Options for {@link useServiceWorkerUpdate}. */
interface ServiceWorkerUpdateOptions {
  /** Called when a new build is installed and waiting to take over. */
  onUpdateAvailable: (applyUpdate: () => void) => void;
  /** Reloads the page once the new worker controls it. */
  reload?: () => void;
  /** Service worker container; defaults to `navigator.serviceWorker`. */
  container?: ServiceWorkerContainerLike;
  /** Registration is skipped when false (for example in the Vite dev server). */
  enabled?: boolean;
}

/**
 * Registers `/sw.js` and reports when a new build is waiting.
 *
 * The service worker never activates itself over open tabs. When a new
 * version has installed, `onUpdateAvailable` receives an `applyUpdate`
 * callback that tells the waiting worker to take over and reloads this tab
 * once it has.
 * @param options Callbacks and injectable dependencies.
 */
export function useServiceWorkerUpdate(options: ServiceWorkerUpdateOptions): void {
  const { onUpdateAvailable, reload, container, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;
    const sw: ServiceWorkerContainerLike | undefined =
      container ??
      (typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined);
    if (!sw) return;

    let cancelled = false;
    let reloading = false;
    let userAccepted = false;
    // A page that loaded without a worker is on a first install: the worker
    // claims it on activation, and nothing it installs later in this page's
    // life is an update the visitor needs to hear about (#1126).
    const startedControlled = Boolean(sw.controller);
    const doReload = reload ?? (() => window.location.reload());

    const onControllerChange = () => {
      // Only reload a tab whose user asked for the update; other tabs keep
      // running, and the previous build's cache stays available to them.
      if (!userAccepted || reloading) return;
      reloading = true;
      doReload();
    };
    sw.addEventListener('controllerchange', onControllerChange);

    const announce = (waiting: ServiceWorker) => {
      if (cancelled || !startedControlled) return;
      onUpdateAvailable(() => {
        userAccepted = true;
        if (waiting.state !== 'installed') {
          // The worker already took over on its own (a schema upgrade), so no
          // controller change is coming: reload now.
          if (!reloading) {
            reloading = true;
            doReload();
          }
          return;
        }
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    };

    sw.register('/sw.js')
      .then((registration) => {
        if (cancelled) return;
        // A worker already waiting from an earlier visit.
        if (registration.waiting) {
          announce(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              announce(installing);
            }
          });
        });
      })
      .catch((err: unknown) => {
        console.error('SW registration failed:', err);
      });

    return () => {
      cancelled = true;
      sw.removeEventListener('controllerchange', onControllerChange);
    };
  }, [onUpdateAvailable, reload, container, enabled]);
}
