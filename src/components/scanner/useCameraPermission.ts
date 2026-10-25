import { useEffect, useState } from 'react';

/**
 * The camera permission for this site, as the Permissions API reports it. Null when the browser
 * cannot say (no Permissions API, or it rejects the camera name, as some Firefox and Safari
 * versions do). Listens for changes, so a camera allowed in the browser settings shows up at once.
 */
export function useCameraPermission(): PermissionState | null {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let active = true;
    const onChange = () => {
      if (status && active) setPermission(status.state);
    };
    let query: Promise<PermissionStatus>;
    try {
      const permissions: Permissions | undefined = typeof navigator === 'undefined' ? undefined : navigator.permissions;
      if (typeof permissions?.query !== 'function') return undefined;
      query = permissions.query({ name: 'camera' });
    } catch {
      return undefined;
    }
    query
      .then((result) => {
        if (!active) return;
        status = result;
        setPermission(result.state);
        result.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      status?.removeEventListener('change', onChange);
    };
  }, []);
  return permission;
}
