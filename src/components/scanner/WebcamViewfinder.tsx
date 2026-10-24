import React, { useId, useRef } from 'react';
import { Camera, Upload } from 'lucide-react';
import type { CameraScanResult, CameraSessionState } from '@/packages/optical-scanner/client';
import { Button } from '../ui/Button';
import { CameraProblemPanel, isCameraProblem } from './cameraProblems';
import { useViewfinderGeometry } from './viewfinderGeometry';
import { usePinchZoom, ViewfinderOverlay } from './ViewfinderOverlay';

interface WebcamViewfinderProps {
  camera: CameraSessionState;
  /** The video element the scan session attaches the camera to. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** False until the person asks for the camera (the standalone page). */
  cameraWanted: boolean;
  /** Corners the reticle is locked onto, or null while searching. */
  lock: CameraScanResult['corners'];
  statusLine: string;
  permission: PermissionState | null;
  canPaste: boolean;
  onStartCamera: () => void;
  onScanImage: () => void;
  onPaste: () => void;
  onRetry: () => void;
  onZoom: (value: number) => void;
}

/**
 * Camera mode of the scanner (#1603): the video, the reticle overlay, the start prompt, the
 * status line and the camera problem panel.
 */
export function WebcamViewfinder({
  camera,
  videoRef,
  cameraWanted,
  lock,
  statusLine,
  permission,
  canPaste,
  onStartCamera,
  onScanImage,
  onPaste,
  onRetry,
  onZoom,
}: WebcamViewfinderProps) {
  const ids = useId();
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const streamingCamera = camera.status === 'streaming' ? camera.camera : null;
  const pinch = usePinchZoom(streamingCamera?.zoom ?? null, onZoom);
  const geometry = useViewfinderGeometry(viewfinderRef, videoRef, camera.status === 'streaming');
  const mirrored = streamingCamera?.facing === 'user';

  // The video element stays mounted so the session always has an element to attach the camera
  // to, including after a retried permission request.
  return (
    <div ref={viewfinderRef} className={`relative size-full bg-camera ${streamingCamera?.zoom ? 'touch-none' : ''}`} {...pinch}>
      {/* Only a user-facing camera is mirrored, and only on screen: the decoder always reads the
          frames as the camera sees them. */}
      <video
        ref={videoRef}
        className={`size-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
        autoPlay
        playsInline
        muted
        aria-label="Webcam feed"
        aria-describedby={`${ids}-status-line`}
      />
      {camera.status === 'streaming' && <ViewfinderOverlay geometry={geometry} lock={lock} mirrored={mirrored} />}
      {!cameraWanted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <Camera className="size-8 text-accent" aria-hidden="true" />
          <p className="max-w-sm text-sm text-fg-muted">
            The browser asks to use your camera. The video stays on this device and the camera turns off when you leave.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={onStartCamera}>
              <Camera className="size-4" aria-hidden="true" />
              Start camera
            </Button>
            <Button variant="secondary" onClick={onScanImage}>
              <Upload className="size-4" aria-hidden="true" />
              Scan an image
            </Button>
          </div>
        </div>
      )}
      {cameraWanted && (camera.status === 'requesting' || camera.status === 'streaming') && (
        <p
          id={`${ids}-status-line`}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-camera/70 px-3 py-1 text-sm font-medium whitespace-nowrap text-on-camera"
        >
          {statusLine}
        </p>
      )}
      {isCameraProblem(camera) && (
        <CameraProblemPanel
          camera={camera}
          permission={permission}
          canPaste={canPaste}
          onScanImage={onScanImage}
          onPaste={onPaste}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}
