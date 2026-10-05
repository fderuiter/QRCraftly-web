// Types only: `scripts/bench_scanner.ts` loads this file from other git refs, so it imports nothing
// at runtime. Callers pass in the reader (#1178).
import type { QrRead, QrReader } from '@/packages/qr-decode';
import type { DecodedCode, ScanCorners } from './contracts';

/**
 * Box-filters RGBA pixels down to `scale` of their size.
 * @param data RGBA pixels.
 * @param width Source width.
 * @param height Source height.
 * @param scale Factor in (0, 1).
 * @returns The downscaled pixels and size.
 */
export function downscaleRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(outW * outH * 4);
  const stepX = width / outW;
  const stepY = height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * stepY);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * stepX);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * stepX)));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * outW + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/** Maps a point of a transformed image back to the frame it was cut from. */
interface Transform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

const IDENTITY: Transform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

/** Converts a read into a {@link DecodedCode}, its corners mapped through `transform`. */
function toDecodedCode(code: QrRead, transform: Transform = IDENTITY): DecodedCode {
  const map = ({ x, y }: { x: number; y: number }) => ({
    x: transform.offsetX + x * transform.scaleX,
    y: transform.offsetY + y * transform.scaleY,
  });
  const [topLeft, topRight, bottomRight, bottomLeft] = code.corners;
  const corners: ScanCorners = [map(topLeft), map(topRight), map(bottomRight), map(bottomLeft)];
  return { text: code.text, bytes: code.bytes, corners };
}

/**
 * Decodes one image with every pass of our reader: local thresholds, then one threshold for the
 * whole image, then half size, each in both polarities. For one-shot images, not camera frames.
 * @param reader The QR reader, from `loadQrReader`.
 * @param data RGBA pixels.
 * @param width Frame width.
 * @param height Frame height.
 * @returns The decoded code (text, bytes and corners in the frame's pixels), or null.
 */
export function decodeRgbaCode(reader: QrReader, data: Uint8ClampedArray, width: number, height: number): DecodedCode | null {
  try {
    const [code] = reader.read(data, width, height, { inverted: true, global: true, half: true });
    return code ? toDecodedCode(code) : null;
  } catch {
    return null;
  }
}

/**
 * One camera-frame decode strategy. The camera loop sees a new frame every few tens of
 * milliseconds, so each frame gets exactly one reader pass and consecutive frames rotate
 * through the strategies (#1096):
 * - `centre`: the centre square of the frame (where the viewfinder reticle is) at native
 *   resolution, for small or distant codes;
 * - `frame`: the whole frame, downscaled to at most {@link FRAME_PASS_MAX_DIMENSION};
 * - `inverted`: the centre square again, looking for light-on-dark codes only.
 */
export type CameraDecodeStrategy = 'centre' | 'frame' | 'inverted';

/** The rotation: the centre crop every other frame, the whole frame and an inverted pass in between. */
const CAMERA_STRATEGIES: readonly CameraDecodeStrategy[] = ['centre', 'frame', 'centre', 'inverted'];
/** Longest edge of the whole-frame passes. */
const FRAME_PASS_MAX_DIMENSION = 800;
/**
 * Picks the strategy for a camera frame.
 * @param sequenceId The frame's sequence number within its scan session (1, 2, ...).
 * @returns The pass to run on that frame.
 */
export function cameraStrategyFor(sequenceId: number): CameraDecodeStrategy {
  const index = (((Math.floor(sequenceId) - 1) % CAMERA_STRATEGIES.length) + CAMERA_STRATEGIES.length) % CAMERA_STRATEGIES.length;
  return CAMERA_STRATEGIES[index];
}

/** Copies the centred square of an RGBA frame and says where it was cut from. */
function cropCentre(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { data: Uint8ClampedArray; width: number; height: number; left: number; top: number } {
  const side = Math.min(width, height);
  if (side === width && side === height) return { data, width, height, left: 0, top: 0 };
  const left = Math.floor((width - side) / 2);
  const top = Math.floor((height - side) / 2);
  const out = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const from = ((top + y) * width + left) * 4;
    out.set(data.subarray(from, from + side * 4), y * side * 4);
  }
  return { data: out, width: side, height: side, left, top };
}

/**
 * Decodes one camera frame with a single reader pass (see {@link CameraDecodeStrategy}). Grainy
 * frames go in at full resolution: the reader's local thresholding copes with sensor noise, and
 * box-downscaling them (which jsQR needed) halves its read rate on noisy frames.
 * @param reader The QR reader, from `loadQrReader`.
 * @param data RGBA pixels.
 * @param width Frame width.
 * @param height Frame height.
 * @param strategy The strategy for this frame, from {@link cameraStrategyFor}.
 * @returns The decoded code (corners in the frame's pixels), or null.
 */
export function decodeCameraCode(
  reader: QrReader,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strategy: CameraDecodeStrategy
): DecodedCode | null {
  try {
    const cut = strategy === 'frame' ? { data, width, height, left: 0, top: 0 } : cropCentre(data, width, height);
    let image = { data: cut.data, width: cut.width, height: cut.height };
    const longest = Math.max(image.width, image.height);
    if (strategy === 'frame' && longest > FRAME_PASS_MAX_DIMENSION) {
      image = downscaleRgba(image.data, image.width, image.height, FRAME_PASS_MAX_DIMENSION / longest);
    }
    if (strategy === 'inverted') {
      // Invert the pixels so this pass looks for light-on-dark codes only, at the cost of one pass.
      const inverted = image.data === data ? new Uint8ClampedArray(image.data) : image.data;
      for (let i = 0; i < inverted.length; i += 4) {
        inverted[i] = 255 - inverted[i];
        inverted[i + 1] = 255 - inverted[i + 1];
        inverted[i + 2] = 255 - inverted[i + 2];
      }
      image = { ...image, data: inverted };
    }
    const [code] = reader.read(image.data, image.width, image.height);
    if (!code) return null;
    return toDecodedCode(code, {
      offsetX: cut.left,
      offsetY: cut.top,
      scaleX: cut.width / image.width,
      scaleY: cut.height / image.height,
    });
  } catch {
    return null;
  }
}

/**
 * Text-only form of {@link decodeCameraCode}.
 * @returns The decoded text, or null.
 */
export function decodeCameraFrame(
  reader: QrReader,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strategy: CameraDecodeStrategy
): string | null {
  return decodeCameraCode(reader, data, width, height, strategy)?.text ?? null;
}

/**
 * Decodes raw RGBA pixel data on the calling thread (see {@link decodeRgbaCode}).
 */
export function decodeImageDataSync(
  reader: QrReader,
  imageData: ImageData | { data: Uint8ClampedArray },
  width: number,
  height: number
): DecodedCode | null {
  return decodeRgbaCode(reader, imageData.data, width, height);
}
