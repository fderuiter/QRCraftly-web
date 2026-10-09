import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServiceWorkerUpdate, type ServiceWorkerContainerLike } from './useServiceWorkerUpdate';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage = vi.fn();
  setState(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}

function createContainer(registration: FakeRegistration, controller: unknown = {}) {
  const target = new EventTarget();
  const container: ServiceWorkerContainerLike & { fireControllerChange: () => void } = {
    controller,
    register: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
    fireControllerChange: () => target.dispatchEvent(new Event('controllerchange')),
  };
  return container;
}

describe('useServiceWorkerUpdate', () => {
  it('registers the service worker', async () => {
    const container = createContainer(new FakeRegistration());
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable: vi.fn(), container }));
    await waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js'));
  });

  it('does nothing when disabled', async () => {
    const container = createContainer(new FakeRegistration());
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable: vi.fn(), container, enabled: false }));
    await Promise.resolve();
    expect(container.register).not.toHaveBeenCalled();
  });

  it('announces a newly installed worker and activates it only after the user accepts', async () => {
    const registration = new FakeRegistration();
    const container = createContainer(registration);
    const onUpdateAvailable = vi.fn();
    const reload = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable, reload, container }));
    await waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');

    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();

    // A controller change this tab didn't ask for must not reload it.
    container.fireControllerChange();
    expect(reload).not.toHaveBeenCalled();

    const applyUpdate = onUpdateAvailable.mock.calls[0][0] as () => void;
    applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    container.fireControllerChange();
    container.fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('announces a worker that was already waiting from an earlier visit', async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    const container = createContainer(registration);
    const onUpdateAvailable = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable, container }));
    await waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
  });

  it('treats the very first install as no update', async () => {
    const registration = new FakeRegistration();
    const container = createContainer(registration, null);
    const onUpdateAvailable = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable, container }));
    await waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('stays quiet in a page that loaded uncontrolled, even after the first worker claims it (#1126)', async () => {
    const registration = new FakeRegistration();
    const container = createContainer(registration, null);
    const onUpdateAvailable = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable, container }));
    await waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    // The first worker activates and claims the page.
    container.controller = {};
    container.fireControllerChange();

    // A later install in the same page's life is not an update for this visitor.
    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    expect(onUpdateAvailable).not.toHaveBeenCalled();
  });

  it('reloads at once when the announced worker already took over on its own', async () => {
    const registration = new FakeRegistration();
    const container = createContainer(registration);
    const onUpdateAvailable = vi.fn();
    const reload = vi.fn();
    renderHook(() => useServiceWorkerUpdate({ onUpdateAvailable, reload, container }));
    await waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.setState('installed');
    worker.setState('activated');

    const applyUpdate = onUpdateAvailable.mock.calls[0][0] as () => void;
    applyUpdate();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
