/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FlaskConical, X } from 'lucide-react';
import type { QRConfig } from '../../types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { RangeInput } from '../ui/RangeInput';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { motionAllowed } from '../../hooks/usePresence';
import { triggerFileDownload } from '../../utils/downloadManager';
import { formatDistance, getPrintGuidance } from '../../utils/printGuidance';
import { testViewingConditions, type ViewingResult } from '../../utils/viewingConditions';
import { MOCKUP_SCENES, SCENE_HEIGHT, SCENE_WIDTH } from './scenes';
import type { PreviewView } from './previewViews';

/** Largest sideways shift of the near layer from parallax, in viewbox units. */
const PARALLAX_RANGE = 10;
/** Pixel width of an exported mockup. */
const EXPORT_WIDTH_PX = 1600;

interface MockupViewProps {
  /** The live preview canvas the code is copied from. */
  sourceRef: React.RefObject<HTMLCanvasElement | null>;
  /** Changes whenever the preview re-renders, so the mockup redraws. */
  renderKey: unknown;
  /** The QR configuration being previewed. */
  config: QRConfig;
  /** Modules per side of the QR matrix. */
  moduleCount: number;
  /** The scene to show. */
  view: Exclude<PreviewView, 'flat'>;
  /**
   * Id of the note saying why exports are off (nothing to encode, or a refused field); the
   * download button is marked unavailable and described by it (#1253).
   */
  exportsOffReason?: string;
  /**
   * Runs the download through the generator's export checks (empty or refused content, scan
   * safety), the same as its main Download (#1253).
   */
  guardExport?: (run: () => Promise<void>) => void;
}

/** Device orientation permission call that iOS Safari adds to the event constructor. */
type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * "In the wild" preview: the live QR placed on an original scene (poster, business card, table
 * tent, phone screen or sticker), with print size, scan distance, a viewing test under real
 * conditions and an export of the scene as a PNG. Everything runs on this device and every scene is
 * drawn in code, so it requests no image or font. Parallax follows the pointer, or the tilt of the
 * phone once switched on, and stays off under reduced motion.
 * @param props - Component properties.
 * @param props.sourceRef - The live preview canvas.
 * @param props.renderKey - Value that changes on every preview render.
 * @param props.config - The QR configuration.
 * @param props.moduleCount - Modules per side of the matrix.
 * @param props.view - Which scene to show.
 * @param props.exportsOffReason - Id of the note saying why exports are off, if they are.
 * @param props.guardExport - Runs the download through the generator's export checks.
 * @returns The mockup view.
 */
export default function MockupView({ sourceRef, renderKey, config, moduleCount, view, exportsOffReason, guardExport }: MockupViewProps) {
  const scene = MOCKUP_SCENES.find((candidate) => candidate.id === view) ?? MOCKUP_SCENES[0];
  const [widthCm, setWidthCm] = useState(scene.defaultCm);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [results, setResults] = useState<ViewingResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef(0);

  const canMove = motionAllowed();
  const coarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  // Off by default on phones, where it needs an explicit opt-in (and a permission on iOS).
  const [tilt, setTilt] = useState(canMove && !coarsePointer);
  const movement = canMove && tilt;

  // A new scene starts at its own usual printed size and forgets the old test.
  useEffect(() => {
    setWidthCm(scene.defaultCm);
  }, [scene]);
  // Results describe one design at one size in one scene.
  useEffect(() => {
    setResults(null);
  }, [renderKey, widthCm, scene, moduleCount]);

  // Copy the preview canvas into the scene once it has painted.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const source = sourceRef.current;
      if (!source || source.width === 0 || source.height === 0) return;
      try {
        setQrUrl(source.toDataURL('image/png'));
      } catch {
        setQrUrl(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sourceRef, renderKey]);

  const move = useCallback((x: number, y: number) => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => setOffset({ x, y }));
  }, []);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // Phone tilt, once switched on.
  useEffect(() => {
    if (!movement || !coarsePointer) return;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const x = Math.max(-1, Math.min(1, (event.gamma ?? 0) / 30));
      const y = Math.max(-1, Math.min(1, ((event.beta ?? 45) - 45) / 30));
      move(x, y);
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [movement, coarsePointer, move]);

  const onTiltChange = async (next: boolean) => {
    if (next && coarsePointer) {
      const orientation = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as OrientationPermission | undefined;
      if (orientation?.requestPermission) {
        try {
          if ((await orientation.requestPermission()) !== 'granted') return;
        } catch {
          return;
        }
      }
    }
    setTilt(next);
    if (!next) setOffset({ x: 0, y: 0 });
  };

  const guidance = useMemo(() => getPrintGuidance(widthCm, moduleCount, config.errorCorrectionLevel), [widthCm, moduleCount, config.errorCorrectionLevel]);

  const runTest = async () => {
    const source = sourceRef.current;
    if (!source || testing) return;
    setTesting(true);
    try {
      setResults(await testViewingConditions(source, config, moduleCount, widthCm));
    } finally {
      setTesting(false);
    }
  };

  const exportPng = async () => {
    const svg = svgRef.current;
    if (!svg || exporting) return;
    setExporting(true);
    try {
      // Export the scene at rest, without the parallax shift.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('[data-layer]').forEach((layer) => layer.setAttribute('transform', 'translate(0 0)'));
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(EXPORT_WIDTH_PX));
      clone.setAttribute('height', String((EXPORT_WIDTH_PX * SCENE_HEIGHT) / SCENE_WIDTH));
      const markup = new XMLSerializer().serializeToString(clone);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The mockup could not be drawn.'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = EXPORT_WIDTH_PX;
      canvas.height = (EXPORT_WIDTH_PX * SCENE_HEIGHT) / SCENE_WIDTH;
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) triggerFileDownload(new Uint8Array(await blob.arrayBuffer()), `qrcraftly-${scene.id}-mockup.png`, 'image/png');
    } finally {
      setExporting(false);
    }
  };

  const { slot } = scene;
  const qr = qrUrl ? (
    <image href={qrUrl} x={slot.x} y={slot.y} width={slot.size} height={slot.size} preserveAspectRatio="xMidYMid meet" transform={slot.transform} data-testid="mockup-qr" />
  ) : null;
  const backShift = `translate(${(-offset.x * PARALLAX_RANGE) / 3} ${(-offset.y * PARALLAX_RANGE) / 3})`;
  const frontShift = `translate(${offset.x * PARALLAX_RANGE} ${offset.y * PARALLAX_RANGE})`;
  const minCm = Math.min(scene.minCm, guidance.minWidthCm);

  return (
    <div className="space-y-4" data-testid="mockup-view">
      <div
        className="overflow-hidden rounded-xl bg-surface-sunken"
        onPointerMove={(event) => {
          if (!movement || event.pointerType === 'touch') return;
          const box = event.currentTarget.getBoundingClientRect();
          move(((event.clientX - box.left) / box.width) * 2 - 1, ((event.clientY - box.top) / box.height) * 2 - 1);
        }}
        onPointerLeave={() => movement && move(0, 0)}
      >
        <svg ref={svgRef} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} role="img" aria-label={`${scene.description} ${scene.printed ? `Printed ${widthCm} cm wide.` : ''}`.trim()} className="block h-auto w-full">
          <defs>
            <linearGradient id="mockup-light" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
            </linearGradient>
          </defs>
          {scene.Scene({ qr, backShift, frontShift })}
          {/* Soft light from one corner so the scene reads as a photo of a real object. */}
          <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="url(#mockup-light)" pointerEvents="none" />
        </svg>
      </div>

      {scene.printed && (
        <div className="space-y-3">
          <RangeInput
            id="mockup-size"
            label="Printed width"
            min={Math.floor(minCm * 2) / 2}
            max={scene.maxCm}
            step={0.5}
            value={widthCm}
            onChange={setWidthCm}
            formatValue={(value) => `${value} cm`}
          />
          <p className="text-sm text-fg-soft" data-testid="mockup-guidance">
            Modules print about {guidance.moduleMm.toFixed(2)} mm wide. A phone scans it from about <strong className="font-semibold text-fg">{formatDistance(guidance.distanceCm)}</strong> away.
          </p>
          {guidance.tooSmall && (
            <Alert variant="warning" title="Too small for this content">
              Modules print at {guidance.moduleMm.toFixed(2)} mm, below the 0.4 mm that scans reliably. Print it at least {(Math.ceil(guidance.minWidthCm * 10) / 10).toFixed(1)} cm wide, or shorten what it holds.
            </Alert>
          )}
        </div>
      )}
      {!scene.printed && <p className="text-sm text-fg-soft">On a screen, scanners read it best when the code fills a third of the screen width or more and the brightness is up.</p>}

      {canMove && (
        <ToggleSwitch id="mockup-tilt" label={coarsePointer ? 'Move with my phone' : 'Move with the pointer'} checked={tilt} onChange={onTiltChange} />
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={runTest} loading={testing}>
            <FlaskConical className="size-4" aria-hidden="true" />
            Test real-world conditions
          </Button>
          <Button
            variant="secondary"
            onClick={() => (guardExport ? guardExport(exportPng) : void exportPng())}
            loading={exporting}
            disabled={!qrUrl}
            aria-disabled={exportsOffReason ? 'true' : undefined}
            aria-describedby={exportsOffReason}
          >
            <Download className="size-4" aria-hidden="true" />
            Download mockup PNG
          </Button>
        </div>
        {results && (
          <ul className="space-y-1.5 text-sm" data-testid="viewing-results" aria-label="Viewing test results">
            {results.map((result) => (
              <li key={result.id} className="flex items-center gap-2" data-passed={String(result.passed)}>
                {result.passed === true ? <Check className="size-4 text-success" aria-hidden="true" /> : result.passed === false ? <X className="size-4 text-danger" aria-hidden="true" /> : <span className="size-4 text-center text-fg-muted" aria-hidden="true">?</span>}
                <span className="text-fg-soft">{result.label}</span>
                <span className="ml-auto font-medium text-fg">{result.passed === true ? 'Still scans' : result.passed === false ? 'Fails to scan' : 'Could not check'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
