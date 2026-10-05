/**
 * Optical Detection Engine — Root Entry Point
 * Encapsulates off-thread Web Worker barcode decoding, polymorphic source extraction and the
 * headless Camera Scanner Engine behind a clean, high-level entry-point seam.
 */

export { scanSource as scan } from './lib/sourceExtractor';

/** Size limits for uploaded images: bytes and declared pixels (#1160). */
export {
  MAX_IMAGE_BYTES,
  IMAGE_TOO_LARGE_BYTES_MESSAGE,
  IMAGE_TOO_LARGE_PIXELS_MESSAGE,
  readImageSize,
  assertImageWithinLimits,
} from './lib/imageLimits';

export {
  createCameraScannerEngine,
  type CameraScannerEngine,
  type CameraScannerEngineConfig,
  type CameraScannerEngineOptions,
  type CameraScannerEngineEvents,
  type CameraScannerEngineMetrics,
  type CameraFrameSource,
  type CameraFrameGrabber,
  type CameraFramePixels,
  type CameraScanResult,
  type CameraCodeDetector,
} from './lib/cameraEngine';

export {
  createCameraSession,
  cameraConstraints,
  type CameraInfo,
  type CameraDevice,
  type CameraMediaDevices,
  type CameraSession,
  type CameraSessionConfig,
  type CameraSessionState,
  type CameraSessionStartOptions,
  type CameraVideoElement,
  type CameraVisibilitySource,
  type CameraFrameLoop,
} from './lib/cameraSession';

/** The camera-frame decoder: one bounded pass of our reader per frame, rotating strategies (#1096). */
export {
  decodeCameraFrame,
  decodeCameraCode,
  cameraStrategyFor,
  type CameraDecodeStrategy,
} from './lib/decodeSync';

/** The platform's `BarcodeDetector`, first in the decoder chain (#1099). */
export { createNativeQrDetector, type NativeQrDetector } from './lib/nativeDetector';

/** Multi-frame confirmation and repeat hold for camera results (#1099). */
export {
  createResultGate,
  type ResultGate,
  type ResultGateOptions,
} from './lib/resultGate';

/** Per-session frame staleness, as the shared scanner worker judges it (#1095). */
export { createStaleFrameGuard, type StaleFrameGuard } from './lib/frameGuard';

export { type ScannerClock } from './lib/clock';

export {
  type ScannerWorkerFactory,
  type ScannerWorkerHandle,
  type ScannerWorkerHandlers,
} from './lib/workerRunner';

export {
  type ScanSource,
  type ScanResult,
  type ScanCorners,
  type ScanPoint,
  type ScanDecoder,
  type ScanRegion,
  type DecodedCode,
  type ScanOptions,
  type ScannerStatus,
  type ScannerRequest,
  type ScannerResponse,
  getDownscaledDimensions,
  isValidScannerRequest,
  assertScannerRequest,
  isValidScannerResponse,
  assertScannerResponse,
  isValidScanOptions,
  assertScanOptions,
} from './lib/contracts';
