import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleCheck, Dices, Redo2, TriangleAlert, Undo2 } from 'lucide-react';
import { QRConfig, SocialFormat, TemplateStyle } from '../../types';
import { PATTERNS, PRESET_COLORS } from '../../constants';
import { getSamplePayload } from '@/packages/qr-payload';
import { useOptionalQRStore, useOptionalQRStoreSelector } from '../../context/QRContext';
import { useDebounce } from '../../hooks/useDebounce';
import { useUndoToast } from '../../hooks/useUndoToast';
import { styleScanTone, surpriseStyle, type StyleChoice } from '../../utils/styleGallery';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip } from '../ui/Tooltip';

interface StyleGalleryProps {
  /** The current QR code configuration. */
  config: QRConfig;
  /** Applies appearance updates. */
  onChange: (updates: Partial<QRConfig>) => void;
}

/** One tile: what it is called, what it changes and how it would look. */
interface Tile {
  id: string;
  name: string;
  patch: Partial<QRConfig>;
  choice: StyleChoice;
}

// Thumbnails kept in memory, newest last. The key holds the QR content, so it never leaves this module.
const THUMBNAIL_CACHE_LIMIT = 80;
const thumbnailCache = new Map<string, string>();

const choiceOf = (config: QRConfig, patch: Partial<QRConfig>): StyleChoice => ({
  style: patch.style ?? config.style,
  fgColor: patch.fgColor ?? config.fgColor,
  bgColor: patch.bgColor ?? config.bgColor,
  eyeColor: patch.eyeColor ?? config.eyeColor,
});

function getThumbnailCacheId(config: QRConfig, choice: StyleChoice): string {
  const value = config.value.trim() ? config.value : getSamplePayload(config.type);
  const thumbConfig: QRConfig = {
    ...config,
    ...choice,
    value,
    logoUrl: null,
    borderLogoUrl: null,
    mosaicImageUrl: null,
    backgroundImageUrl: null,
    isBorderEnabled: false,
    isMazeEnabled: false,
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
    animationValues: undefined,
    isAnimating: false,
  };
  return JSON.stringify([thumbConfig.type, value, thumbConfig.errorCorrectionLevel, choice]);
}

function getCachedThumbnail(config: QRConfig, choice: StyleChoice): string | undefined {
  const cacheId = getThumbnailCacheId(config, choice);
  return thumbnailCache.get(cacheId);
}

const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

/**
 * Renders a small picture of the person's own QR code in a candidate look, as an SVG data
 * URL. It runs on this device and nothing is sent or stored. The logo, border, template and
 * maze are left out so every tile compares just the pattern and colours.
 * @param config - Current configuration.
 * @param choice - Pattern and colours to draw.
 * @returns A data URL for an `<img>`.
 */
async function renderThumbnail(config: QRConfig, choice: StyleChoice): Promise<string> {
  const value = config.value.trim() ? config.value : getSamplePayload(config.type);
  const thumbConfig: QRConfig = {
    ...config,
    ...choice,
    value,
    logoUrl: null,
    borderLogoUrl: null,
    mosaicImageUrl: null,
    backgroundImageUrl: null,
    isBorderEnabled: false,
    isMazeEnabled: false,
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
    animationValues: undefined,
    isAnimating: false,
  };
  const cacheId = JSON.stringify([thumbConfig.type, value, thumbConfig.errorCorrectionLevel, choice]);
  const cached = thumbnailCache.get(cacheId);
  if (cached) return cached;
  const { generateQRSvg } = await import('@/packages/qr-export');
  const svg = await generateQRSvg(thumbConfig);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  thumbnailCache.set(cacheId, url);
  if (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) thumbnailCache.delete(thumbnailCache.keys().next().value as string);
  return url;
}

// The tile content: the thumbnail, its name and the scan outlook icon.
function TileFace({ tile, src }: { tile: Tile; src?: string }) {
  const tone = styleScanTone(tile.choice);
  return (
    <span data-choice={tile.id} className="flex w-full flex-col items-center gap-1">
      <span className="relative block size-16 overflow-hidden rounded-md bg-surface-sunken ring-1 ring-line">
        {src && <img src={src} alt="" width={64} height={64} className="size-full" draggable={false} />}
      </span>
      <span className="flex items-center gap-1 text-center leading-tight">
        {tone === 'good' ? (
          <CircleCheck className="size-3 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden="true" />
        )}
        {tile.name}
      </span>
    </span>
  );
}

/**
 * Live style gallery: every pattern and colour preset drawn on the person's own QR code.
 * Hovering a tile with a mouse previews it on the main preview, moving away puts it back,
 * and choosing one is a single undoable step. "Surprise me" picks a look that is expected
 * to scan. The check or warning icon on each tile is an estimate from contrast and pattern; the live scan
 * check on the preview decides. Everything happens on this device and nothing is stored.
 * @param props - Component properties.
 * @param props.config - Current configuration.
 * @param props.onChange - Applies appearance updates.
 * @returns The gallery.
 */
const StyleGallery: React.FC<StyleGalleryProps> = ({ config, onChange }) => {
  const store = useOptionalQRStore();
  const canUndo = useOptionalQRStoreSelector((s) => s.canUndo) ?? false;
  const canRedo = useOptionalQRStoreSelector((s) => s.canRedo) ?? false;
  const notifyUndo = useUndoToast();
  // While a tile is previewed the main config shows the preview, so the gallery keeps drawing from the look underneath.
  const [baseChoice, setBaseChoice] = useState<StyleChoice | null>(null);
  const source = useMemo<QRConfig>(() => (baseChoice ? { ...config, ...baseChoice } : config), [config, baseChoice]);
  const baseLook = choiceOf(source, {});

  const patternTiles = useMemo<Tile[]>(
    () => PATTERNS.map((p) => ({ id: `pattern:${p.id}`, name: p.label, patch: { style: p.id }, choice: choiceOf(source, { style: p.id }) })),
    [source]
  );
  const colorTiles = useMemo<Tile[]>(
    () =>
      PRESET_COLORS.map((c) => {
        const patch = { fgColor: c.fg, bgColor: c.bg, eyeColor: c.eye, eyeFrameColor: c.eye, eyeBallColor: c.eye };
        return { id: `color:${c.label}`, name: c.label, patch, choice: choiceOf(source, patch) };
      }),
    [source]
  );
  const tileById = useMemo(() => new Map([...patternTiles, ...colorTiles].map((t) => [t.id, t])), [patternTiles, colorTiles]);

  // Thumbnails follow the QR content and look, after a short pause so typing stays smooth.
  const settled = useDebounce(source, 250);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const tiles = [
      ...PATTERNS.map((p) => ({ id: `pattern:${p.id}`, choice: choiceOf(settled, { style: p.id }) })),
      ...PRESET_COLORS.map((c) => ({
        id: `color:${c.label}`,
        choice: choiceOf(settled, { fgColor: c.fg, bgColor: c.bg, eyeColor: c.eye, eyeFrameColor: c.eye, eyeBallColor: c.eye }),
      })),
    ];

    void (async () => {
      // 1. Synchronously check in-memory cache before triggering render tasks
      const batchBuffer: Record<string, string> = {};
      const uncachedTiles: typeof tiles = [];

      for (const tile of tiles) {
        const cachedUrl = getCachedThumbnail(settled, tile.choice);
        if (cachedUrl) {
          batchBuffer[tile.id] = cachedUrl;
        } else {
          uncachedTiles.push(tile);
        }
      }

      // If any cached tiles exist, flush them in a single dispatch immediately
      if (Object.keys(batchBuffer).length > 0) {
        setThumbnails((prev) => ({ ...prev, ...batchBuffer }));
      }

      if (uncachedTiles.length === 0 || cancelled) return;

      // 2. Process uncached tiles with cooperative frame scheduling (8ms max main-thread slice)
      let frameStart = performance.now();
      const MAX_FRAME_SLICE_MS = 8;

      for (let i = 0; i < uncachedTiles.length; i++) {
        if (cancelled) return;

        // Yield execution to main thread if processing slice per frame exceeds 8ms
        if (i > 0 && performance.now() - frameStart >= MAX_FRAME_SLICE_MS) {
          await yieldToMain();
          if (cancelled) return;
          frameStart = performance.now();
        }

        const tile = uncachedTiles[i];
        try {
          const url = await renderThumbnail(settled, tile.choice);
          if (cancelled) return;
          batchBuffer[tile.id] = url;
        } catch {
          // A tile that cannot be drawn stays empty; the controls below still work.
        }
      }

      // 3. Flush accumulated thumbnail updates in a single final dispatch
      if (!cancelled) {
        setThumbnails((prev) => ({ ...prev, ...batchBuffer }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settled]);

  const endPreview = useCallback(() => {
    store?.preview(null);
    setBaseChoice(null);
  }, [store]);
  useEffect(() => () => store?.preview(null), [store]);

  const startPreview = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!store || event.pointerType !== 'mouse') return;
    const id = (event.target as Element).closest('[role="radio"]')?.querySelector('[data-choice]')?.getAttribute('data-choice');
    const tile = id ? tileById.get(id) : undefined;
    if (!tile) {
      endPreview();
      return;
    }
    setBaseChoice((current) => current ?? choiceOf(config, {}));
    store.preview(tile.patch);
  };

  const apply = (tile: Tile) => {
    endPreview();
    onChange(tile.patch);
  };

  const surprise = () => {
    endPreview();
    onChange(surpriseStyle(Math.random, choiceOf(config, {})));
    notifyUndo('New style applied');
  };

  const selected = (tiles: Tile[]) =>
    tiles.find((t) => Object.entries(t.patch).every(([key, value]) => baseLook[key as keyof StyleChoice] === value))?.id ?? '';

  const option = (tile: Tile, kind: 'pattern' | 'color') => {
    const tone = styleScanTone(tile.choice);
    return {
      value: tile.id,
      ariaLabel: `${tile.name} ${kind}, ${tone === 'good' ? 'expected to scan' : 'test before printing'}`,
      label: <TileFace tile={tile} src={thumbnails[tile.id]} />,
    };
  };

  return (
    <div className="space-y-5" onPointerOver={startPreview} onPointerLeave={endPreview}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={surprise}>
          <Dices className="size-4" aria-hidden="true" />
          Surprise me
        </Button>
        <div className="ml-auto flex gap-1">
          <Tooltip content="Undo">
            <Button variant="ghost" iconOnly size="sm" aria-label="Undo style change" aria-disabled={canUndo ? undefined : 'true'} onClick={() => void store?.undo()}>
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
          <Tooltip content="Redo">
            <Button variant="ghost" iconOnly size="sm" aria-label="Redo style change" aria-disabled={canRedo ? undefined : 'true'} onClick={() => void store?.redo()}>
              <Redo2 className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div>
        <h4 id="gallery-patterns" className="mb-3 text-sm font-semibold text-fg-soft">
          Patterns
        </h4>
        <SegmentedControl<string>
          appearance="tiles"
          labelledBy="gallery-patterns"
          className="grid-cols-3 text-xs"
          value={selected(patternTiles)}
          onChange={(id) => apply(tileById.get(id) ?? patternTiles[0])}
          options={patternTiles.map((t) => option(t, 'pattern'))}
        />
      </div>

      <div>
        <h4 id="gallery-colors" className="mb-3 text-sm font-semibold text-fg-soft">
          Colors
        </h4>
        <SegmentedControl<string>
          appearance="tiles"
          labelledBy="gallery-colors"
          className="grid-cols-3 text-xs"
          value={selected(colorTiles)}
          onChange={(id) => apply(tileById.get(id) ?? colorTiles[0])}
          options={colorTiles.map((t) => option(t, 'color'))}
        />
      </div>

      <p className="text-xs text-fg-muted">
        <CircleCheck className="mr-1 inline size-3 text-success" aria-hidden="true" />
        expected to scan, <TriangleAlert className="mx-1 inline size-3 text-warning" aria-hidden="true" />
        test before printing. An estimate from contrast and pattern; the scan check on the preview decides. Hover a tile to preview it.
      </p>
    </div>
  );
};

export default StyleGallery;
