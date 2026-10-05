/**
 * The zxing-cpp WebAssembly reader, as the scanner worker runs it (ADR 0023).
 *
 * The worker never loads the `.wasm` itself: the main thread compiles it from our own origin
 * (`lib/zxingModule.ts`) and posts the compiled `WebAssembly.Module`, which is instantiated here
 * through Emscripten's `instantiateWasm` hook. The build strips every network loader from the
 * zxing-wasm glue (`scripts/vite/zxingNoNetwork.ts`), so this code cannot fetch anything.
 *
 * Until a module is installed, or when instantiating it fails, the worker keeps decoding with our reader (#1178).
 */
import { prepareZXingModule, readBarcodes, type ReaderOptions, type ReadResult } from 'zxing-wasm/reader';
import type { DecodedCode, ScanCorners } from './contracts';

/**
 * QR codes only: zxing's defaults also search for every 1D and 2D format, which is 5 to 15 times
 * slower. `tryHarder`, `tryInvert` and `tryRotate` keep the robustness measured in #1104.
 */
const READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryInvert: true,
  tryRotate: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

/** The reader's state in this worker. */
export type ZxingState = 'absent' | 'loading' | 'ready' | 'failed';

let state: ZxingState = 'absent';
let installing: Promise<boolean> | null = null;

/** Where the reader stands: not offered yet, being instantiated, usable, or failed (our reader only). */
export function zxingState(): ZxingState {
  return state;
}

/**
 * Instantiates the reader from a module compiled on the main thread. Later calls return the first
 * installation's outcome.
 * @param module The compiled `zxing_reader.wasm`.
 * @returns Whether the reader is usable.
 */
export function installZxing(module: WebAssembly.Module): Promise<boolean> {
  if (installing) return installing;
  state = 'loading';
  installing = new Promise<boolean>((resolve) => {
    const fail = () => {
      state = 'failed';
      resolve(false);
    };
    try {
      prepareZXingModule({
        overrides: {
          instantiateWasm(
            imports: WebAssembly.Imports,
            receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
          ) {
            WebAssembly.instantiate(module, imports).then((instance) => receiveInstance(instance, module), fail);
            return {};
          },
        },
        fireImmediately: true,
      }).then(() => {
        state = 'ready';
        resolve(true);
      }, fail);
    } catch {
      fail();
    }
  });
  return installing;
}

/** Waits for an installation in progress; resolves at once when none was started. */
export function whenZxingSettled(): Promise<boolean> {
  return installing ?? Promise.resolve(false);
}

function toDecodedCode(result: ReadResult): DecodedCode {
  const { topLeft, topRight, bottomRight, bottomLeft } = result.position;
  const point = ({ x, y }: { x: number; y: number }) => ({ x, y });
  const corners: ScanCorners = [point(topLeft), point(topRight), point(bottomRight), point(bottomLeft)];
  return { text: result.text, bytes: Uint8Array.from(result.bytes), corners };
}

/**
 * Decodes RGBA pixels with the reader. Call only when {@link zxingState} is `ready`.
 * @returns The code (corners in the given pixels), or null.
 */
export async function decodeWithZxing(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Promise<DecodedCode | null> {
  const results = await readBarcodes(new ImageData(data, width, height), READER_OPTIONS);
  const valid = results.find((result) => result.isValid);
  return valid ? toDecodedCode(valid) : null;
}
