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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createScannabilityWorker } from '@/packages/scannability';
import { EmpiricalScanPipeline, type DetectorLike, type ScanOutcome } from './lib/scanPipeline';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Keeps a ref pointing at the latest value (updated after each render, before paint), so
 * long-lived callbacks such as animation loops read fresh props without re-subscribing.
 * @param value - The value to track.
 * @returns A ref whose \`current\` is the latest committed value.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Subscribes to a CSS media query. Returns false during server rendering.
 * @param query - The media query.
 * @returns Whether it currently matches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  const getSnapshot = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Whether the visitor asked for reduced motion; screen shake and particles are disabled then.
 * @returns True under `prefers-reduced-motion: reduce`.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Scanner verdict shown in the HUD; `pending` until the first scan of a board finishes. */
export type EmpiricalState = ScanOutcome | { status: 'pending'; decoded: null; engine: 'none' };

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): DetectorLike;
}

function createNativeDetector(): DetectorLike | null {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorConstructor }).BarcodeDetector;
    return new Ctor({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/** Inputs of {@link useEmpiricalScan}. */
export interface UseEmpiricalScanOptions {
  /** Renders the current board into a scan frame. */
  captureFrame: () => ImageData | null;
  /** Payload the board encodes. */
  expectedPayload: () => string;
  /** Whether the player is still firing. */
  isInputActive: () => boolean;
  /** Changes whenever the board is rebuilt (new target or heal), which re-scans it. */
  boardKey: string;
}

/** Output of {@link useEmpiricalScan}. */
export interface UseEmpiricalScanResult {
  /** Latest verdict. */
  state: EmpiricalState;
  /** Requests a scan after a damage event. */
  request: () => void;
  /** Runs the catch-up scan once input stops. */
  settle: () => void;
  /** Whether a native `BarcodeDetector` is used. */
  isNative: boolean;
}

/**
 * React binding for Layer 2 of the dual-layer verification engine.
 * @param options - Frame capture and board identity.
 * @returns The verdict and request functions.
 */
export function useEmpiricalScan(options: UseEmpiricalScanOptions): UseEmpiricalScanResult {
  const [state, setState] = useState<EmpiricalState>({ status: 'pending', decoded: null, engine: 'none' });
  const [isNative, setIsNative] = useState(false);
  const pipelineRef = useRef<EmpiricalScanPipeline | null>(null);
  const optionsRef = useLatestRef(options);

  useEffect(() => {
    const detector = createNativeDetector();
    setIsNative(detector !== null);
    const pipeline = new EmpiricalScanPipeline({
      captureFrame: () => optionsRef.current.captureFrame(),
      expectedPayload: () => optionsRef.current.expectedPayload(),
      isInputActive: () => optionsRef.current.isInputActive(),
      onResult: setState,
      detector,
      createWorker: createScannabilityWorker,
    });
    pipelineRef.current = pipeline;
    return () => {
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [optionsRef]);

  useEffect(() => {
    setState({ status: 'pending', decoded: null, engine: 'none' });
    pipelineRef.current?.request();
  }, [options.boardKey]);

  const request = useCallback(() => pipelineRef.current?.request(), []);
  const settle = useCallback(() => pipelineRef.current?.settle(), []);

  return { state, request, settle, isNative };
}
