import type { QRStore } from '@/context/QRContext';
import type { StyleFileResult } from '@/utils/styleFile';

/**
 * Reads a dropped or uploaded style file and applies it to the store.
 */
export async function readAndApplyStyleFile(
  file: File,
  store: QRStore,
  addToast: (toast: { type: 'error' | 'success' | 'info'; message: string; duration?: number }) => void,
  notifyUndo: (message: string) => void,
  isCurrent: () => boolean
): Promise<void> {
  const showError = (message: string) => addToast({ type: 'error', message, duration: 6000 });
  let result: StyleFileResult;
  try {
    const { parseStyleFile, MAX_STYLE_FILE_BYTES } = await import('@/utils/styleFile');
    result = file.size > MAX_STYLE_FILE_BYTES
      ? ({ ok: false, reason: 'That file is too large to be a QRCraftly style file.' } as const)
      : parseStyleFile(await file.text());
  } catch {
    if (isCurrent()) showError('That style file could not be read. Try again.');
    return;
  }
  if (!isCurrent()) return;
  if (!result.ok) {
    showError(result.reason);
    return;
  }
  store.updateConfig(result.style);
  notifyUndo(result.skipped > 0 ? `Style loaded; ${result.skipped} setting${result.skipped === 1 ? '' : 's'} could not be used.` : 'Style loaded');
}

/**
 * Handles style file drop events from the window.
 */
export async function handleStyleDrop(
  event: DragEvent,
  store: QRStore,
  addToast: (toast: { type: 'error' | 'success' | 'info'; message: string; duration?: number }) => void,
  notifyUndo: (message: string) => void,
  isCurrent: () => boolean
): Promise<void> {
  const file = Array.from(event.dataTransfer?.files ?? []).find((f) => /\.json$/i.test(f.name));
  if (file) {
    await readAndApplyStyleFile(file, store, addToast, notifyUndo, isCurrent);
  } else {
    addToast({ type: 'info', message: 'Drop a .qrcraftly.json style file to load a style.', duration: 5000 });
  }
}

/**
 * Serializes and triggers the download of the current QR style configuration.
 */
export async function exportStyleFileAction(
  store: QRStore,
  addToast: (toast: { type: 'error' | 'success' | 'info'; message: string; duration?: number }) => void
): Promise<void> {
  const [{ serializeStyle }, { triggerFileDownload }] = await Promise.all([
    import('@/utils/styleFile'),
    import('@/utils/downloadManager'),
  ]);
  triggerFileDownload(
    new TextEncoder().encode(serializeStyle(store.getState().config)),
    'qrcraftly-style.qrcraftly.json',
    'application/json'
  );
  addToast({ type: 'success', message: 'Style saved. It holds colors and layout only, never your content.', duration: 5000 });
}
