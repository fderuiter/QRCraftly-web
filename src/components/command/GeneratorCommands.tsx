import React, { lazy, Suspense, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQRStore } from '@/context/QRContext';
import { useToast } from '@/components/ui/Toast';
import { useUndoToast } from '@/hooks/useUndoToast';
import { usesCommandKey, useGeneratorShortcuts } from './useGeneratorShortcuts';
import type { buildCommands, Command, GeneratorActions } from './commands';

// The palette, its command list and the style file code load on first use, so they cost
// nothing on a page that never opens them.
const loadPalette = () => import('./CommandPalette');
const CommandPalette = lazy(() => loadPalette().then((m) => ({ default: m.CommandPalette })));
const ShortcutHelp = lazy(() => loadPalette().then((m) => ({ default: m.ShortcutHelp })));

type Panel = 'closed' | 'palette' | 'help';

interface GeneratorCommandsProps {
  /** Export actions of the generator. */
  actions: GeneratorActions;
  /** Runs the Download button's action (the format chosen last). */
  onDownload: () => void;
}

/**
 * Keyboard power features of the generator: shortcuts (undo, redo, download, copy, palette,
 * cheat sheet), the command palette, and saving and loading a style file by menu or by
 * dropping a `.json` file anywhere on the page. Renders nothing visible until a panel opens.
 * @param props - Component properties.
 * @param props.actions - Export actions of the generator.
 * @param props.onDownload - The Download button's action.
 * @returns The panels and the hidden file input.
 */
export function GeneratorCommands({ actions, onDownload }: GeneratorCommandsProps) {
  const store = useQRStore();
  const { addToast } = useToast();
  const notifyUndo = useUndoToast();
  const [panel, setPanel] = useState<Panel>('closed');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modLabel = usesCommandKey() ? '⌘' : 'Ctrl';

  const applyStyleFile = useCallback(
    async (file: File) => {
      const { parseStyleFile, MAX_STYLE_FILE_BYTES } = await import('@/utils/styleFile');
      const result = file.size > MAX_STYLE_FILE_BYTES
        ? ({ ok: false, reason: 'That file is too large to be a QRCraftly style file.' } as const)
        : parseStyleFile(await file.text());
      if (!result.ok) {
        addToast({ type: 'error', message: result.reason, duration: 6000 });
        return;
      }
      store.updateConfig(result.style);
      notifyUndo(result.skipped > 0 ? `Style loaded; ${result.skipped} setting${result.skipped === 1 ? '' : 's'} could not be used.` : 'Style loaded');
    },
    [store, addToast, notifyUndo]
  );

  const exportStyleFile = useCallback(async () => {
    const [{ serializeStyle }, { triggerFileDownload }] = await Promise.all([import('@/utils/styleFile'), import('@/utils/downloadManager')]);
    triggerFileDownload(new TextEncoder().encode(serializeStyle(store.getState().config)), 'qrcraftly-style.qrcraftly.json', 'application/json');
    addToast({ type: 'success', message: 'Style saved. It holds colors and layout only, never your content.', duration: 5000 });
  }, [store, addToast]);

  useGeneratorShortcuts({
    undo: () => void store.undo(),
    redo: () => void store.redo(),
    download: onDownload,
    copyImage: actions.copyImage,
    togglePalette: () => setPanel((current) => (current === 'palette' ? 'closed' : 'palette')),
    showHelp: () => setPanel('help'),
    paletteOpen: panel === 'palette',
  });

  // A style file dropped anywhere on the page. Zones that handle their own drops (the logo
  // upload) mark the event as handled first and are left alone.
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      const file = Array.from(event.dataTransfer?.files ?? []).find((f) => /\.json$/i.test(f.name));
      if (file) void applyStyleFile(file);
      else addToast({ type: 'info', message: 'Drop a .qrcraftly.json style file to load a style.', duration: 5000 });
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [applyStyleFile, addToast]);

  const close = useCallback(() => setPanel('closed'), []);
  const [commands, setCommands] = useState<Command[]>([]);
  // Reads the latest store, actions and labels at the moment the palette's commands are built.
  const showPaletteCommands = useEffectEvent((build: typeof buildCommands) => {
    setCommands(
      build({
        store,
        actions,
        modLabel,
        notifyUndo,
        exportStyleFile: () => void exportStyleFile(),
        importStyleFile: () => fileInputRef.current?.click(),
        showShortcuts: () => setPanel('help'),
      })
    );
  });
  // Rebuilt each time the palette opens so Undo/Redo and the border label are current.
  useEffect(() => {
    if (panel !== 'palette') return;
    let cancelled = false;
    void import('./commands').then(({ buildCommands: build }) => {
      if (cancelled) return;
      showPaletteCommands(build);
    });
    return () => {
      cancelled = true;
    };
  }, [panel]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-label="Load style file"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void applyStyleFile(file);
        }}
      />
      {panel !== 'closed' && (
        <Suspense fallback={null}>
          {panel === 'palette' ? <CommandPalette open onClose={close} commands={commands} /> : <ShortcutHelp open onClose={close} modLabel={modLabel} />}
        </Suspense>
      )}
    </>
  );
}
