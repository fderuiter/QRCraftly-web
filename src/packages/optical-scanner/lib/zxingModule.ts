/**
 * Compiles the zxing-cpp reader (`zxing_reader.wasm`) on the main thread, from our own origin, for
 * the scanner worker (ADR 0023). The file is a hashed build asset, fetched once, only when a scan
 * needs the worker (no native `BarcodeDetector` for QR codes), and cached by the service worker
 * afterwards. Nothing about the scanned content is sent: it is a plain GET of a static file.
 *
 * The compiled `WebAssembly.Module` is posted to the worker, which instantiates it without any
 * network access of its own (`lib/zxingReader.ts`).
 */
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

let compiled: Promise<WebAssembly.Module | null> | null = null;

/**
 * Compiles the reader once per page. Resolves null when WebAssembly is unavailable (or blocked by a
 * stricter CSP) or the file cannot be loaded; the worker then keeps using our reader (#1178).
 */
export function compileZxingModule(): Promise<WebAssembly.Module | null> {
  compiled ??= (async (): Promise<WebAssembly.Module | null> => {
    if (typeof WebAssembly === 'undefined' || typeof fetch !== 'function') return null;
    try {
      // Same-origin static asset. `scripts/bundle_ast_audit.js` authorizes the fetch calls in this
      // function only, by the warning text below.
      if (typeof WebAssembly.compileStreaming === 'function') {
        try {
          return await WebAssembly.compileStreaming(fetch(zxingReaderWasmUrl, { credentials: 'same-origin' }));
        } catch {
          // A server that does not send application/wasm: compile the bytes instead.
        }
      }
      const answer = await fetch(zxingReaderWasmUrl, { credentials: 'same-origin' });
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      return await WebAssembly.compile(await answer.arrayBuffer());
    } catch (err) {
      console.warn('zxing-reader-wasm unavailable, scanning with qr-decode:', err);
      return null;
    }
  })();
  return compiled;
}
