import { Copy, FileImage, RefreshCw, Upload } from 'lucide-react';
import type { CameraProblemStatus, CameraSessionState } from '@/packages/optical-scanner/client';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';

/** What each camera problem is called and how to get past it (#1100). */
const CAMERA_PROBLEMS: Record<CameraProblemStatus, { title: string; body: string; retry: boolean }> = {
  denied: { title: 'Camera Access Denied', body: 'You can still scan a QR code from a photo or screenshot.', retry: false },
  unavailable: {
    title: 'No Camera Found',
    body: 'This device has no camera the browser can use. You can still scan a QR code from a photo or screenshot.',
    retry: false,
  },
  busy: {
    title: 'Camera In Use',
    body: 'Another app or browser tab is using the camera. Close it and try again, or scan a photo or screenshot instead.',
    retry: true,
  },
  unsupported: {
    title: 'Camera Not Supported',
    body: 'This camera cannot stream at a size the scanner can use. Try another camera, or scan a photo or screenshot.',
    retry: true,
  },
  stopped: {
    title: 'Camera Stopped',
    body: 'The camera stopped, perhaps because it was unplugged or another app took it. Try it again, or scan a photo or screenshot.',
    retry: true,
  },
  error: { title: 'Camera Unavailable', body: 'You can still scan a QR code from a photo or screenshot.', retry: true },
};

/** Shown instead of the denied copy when the browser has blocked the camera for this site. */
const BLOCKED_PROBLEM = {
  title: 'Camera blocked for this site',
  body: 'Your browser is blocking the camera for this site. To allow it, click the padlock or site settings icon in the address bar, set Camera to Allow, then reload this page.',
  retry: false,
};

export type CameraProblem = Extract<CameraSessionState, { error: Error }>;

export const isCameraProblem = (state: CameraSessionState): state is CameraProblem => 'error' in state;

/** Platform-specific instructions for resolving camera permission issues. */
function getPlatformInstructions(): string {
  if (typeof navigator === 'undefined') {
    return 'Please enable camera access in your system settings.';
  }
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  if (isIOS) {
    return 'Open iOS Settings, go to your active Browser (e.g., Safari/Chrome), and ensure Camera access is set to "Allow".';
  }
  if (/Android/.test(ua)) {
    return 'Open Android Settings, go to Apps > [Browser Name] > Permissions, and enable Camera access.';
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return 'Open macOS System Settings > Privacy & Security > Camera, and ensure your browser is allowed to access the camera.';
  }
  if (/Windows/.test(ua)) {
    return 'Open Windows Settings > Privacy & Security > Camera, and toggle "Let apps access your camera" and your browser to ON.';
  }
  return "Click the padlock or site control icon next to the URL in your browser's address bar, and allow Camera permissions.";
}

interface CameraProblemPanelProps {
  camera: CameraProblem;
  /** The site's camera permission, or null when the browser cannot say. */
  permission: PermissionState | null;
  /** Whether "Paste a screenshot" can read the clipboard here. */
  canPaste: boolean;
  onScanImage: () => void;
  onPaste: () => void;
  onRetry: () => void;
}

/**
 * What went wrong with the camera and how to get past it (#1100). It leads with the ways that
 * work without a camera; permission help is secondary.
 */
export function CameraProblemPanel({ camera, permission, canPaste, onScanImage, onPaste, onRetry }: CameraProblemPanelProps) {
  const denied = camera.status === 'denied';
  // A block in the site settings cannot be cleared by asking again, so say how to allow it.
  const blocked = denied && permission === 'denied';
  const allowedSinceDenied = denied && permission === 'granted';
  const problem = blocked ? BLOCKED_PROBLEM : CAMERA_PROBLEMS[camera.status];
    return (
      <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto bg-surface p-4">
        <p className="sr-only" role="alert">
          {problem.title}. {problem.body}
        </p>
        <EmptyState
          illustration={<FileImage className="size-6" />}
          title={problem.title}
          body={problem.body}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={onScanImage}>
                <Upload className="size-4" aria-hidden="true" />
                Scan from an image instead
              </Button>
              {canPaste && (
                <Button variant="secondary" onClick={onPaste}>
                  <Copy className="size-4" aria-hidden="true" />
                  Paste a screenshot
                </Button>
              )}
            </div>
          }
        />
        {denied && (
          <div className="flex flex-col items-center gap-2 text-center text-xs text-fg-muted">
            {!blocked && <p className="max-w-sm">To use the camera: {getPlatformInstructions()}</p>}
            {blocked && (
              <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Reload page
              </Button>
            )}
            {!blocked && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {allowedSinceDenied ? 'Start camera' : 'Retry Permission'}
              </Button>
            )}
          </div>
        )}
        {problem.retry && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Try the camera again
            </Button>
          </div>
        )}
      </div>
    );
}
