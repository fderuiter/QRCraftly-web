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

import { useCallback, useEffect, useRef, useState } from 'react';
import { hexToBytes } from '@/packages/core/encoding';
import { loadQrEncoder, type QrSymbolEncoder } from '@/packages/qr-matrix/encoder';
import { createFeedbackMeter } from '../feedback/meter';
import { FountainRateTracker, type FountainTelemetry } from '../fountain/reassembler';
import { layerHint } from '../multicode/layerHint';
import { frameLayer } from '../multicode/multirate';
import { FEEDBACK_NONCE_BYTES, encodeFeedbackFrame } from '../prism/frame';
import { paintBeacon } from '../sender/tiles';
import type { TileCode } from './tileContracts';

/** Camera frames the layer hint looks back over (#1143). */
const LAYER_WINDOW_FRAMES = 30;
/** How often the feedback code is repainted: the back channel's simulation assumes 4 a second. */
const FEEDBACK_REFRESH_MS = 250;

export interface ReceiverTelemetryInputs {
  /** Several codes are read per camera frame (#1142). */
  multiCode: boolean;
  isScanning: boolean;
  receiverSuccess: boolean;
  /** The session in view, from its manifest. */
  sessionId: string | null;
  fountainStats: FountainTelemetry | null;
}

/**
 * What the receiver measures and tells (#1514): the rate tracker, the layer window and its 1 s
 * hint, and the feedback code repainted every 250 ms. Moved from `useOpticalReceiver`; both
 * intervals stop on unmount.
 * @param inputs - Where the receive stands.
 */
export function useReceiverTelemetry({ multiCode, isScanning, receiverSuccess, sessionId, fountainStats }: ReceiverTelemetryInputs) {
  const rateTrackerRef = useRef(new FountainRateTracker());
  /** What the multi-code receiver tells the person about the layer it reads (#1143), or null. */
  const [layerHintText, setLayerHintText] = useState<string | null>(null);
  /** The layers of the last camera frames that read a transfer code. */
  const layerWindowRef = useRef<Array<'dense' | 'beacon'>>([]);
  /** When the transfer last made progress (a manifest or a higher rank), or null before it started. */
  const lastProgressRef = useRef<number | null>(null);
  const lastRankRef = useRef(0);
  /** Show a feedback code the sender's webcam can read to pick its speed and stop (#1146). Off by default. */
  const [steerSender, setSteerSender] = useState(false);
  /** The canvas the feedback code is painted on, in a corner of the page. */
  const feedbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedbackMeterRef = useRef(createFeedbackMeter());

  /** Records one multi-code camera frame for the feedback meter and the layer window. */
  const recordFrameRead = useCallback((codes: readonly TileCode[]) => {
    feedbackMeterRef.current.record(codes);
    const layer = frameLayer(codes.map((code) => code.text));
    if (!layer) return;
    const recent = layerWindowRef.current;
    recent.push(layer);
    if (recent.length > LAYER_WINDOW_FRAMES) recent.shift();
  }, []);

  /** A manifest arrived: the transfer has started, if it had not. */
  const noteManifest = useCallback(() => {
    lastProgressRef.current ??= performance.now();
  }, []);

  /** Notes a decode step and returns the telemetry it gives. */
  const noteProgress = useCallback((stats: { k: number; rank: number; resolved: number; dropletsReceived: number; progress: number }) => {
    if (stats.rank > lastRankRef.current) {
      lastRankRef.current = stats.rank;
      lastProgressRef.current = performance.now();
    }
    return rateTrackerRef.current.telemetry(stats, performance.now());
  }, []);

  /** Counts one transfer frame read. */
  const recordDroplet = useCallback(() => rateTrackerRef.current.record(performance.now()), []);
  const resetRate = useCallback(() => rateTrackerRef.current.reset(), []);

  /** Forgets everything measured, as Clear does. */
  const reset = useCallback(() => {
    layerWindowRef.current = [];
    feedbackMeterRef.current.reset();
    lastProgressRef.current = null;
    lastRankRef.current = 0;
    setLayerHintText(null);
    rateTrackerRef.current.reset();
  }, []);

  // The feedback code (#1146): four times a second while the person lets the sender steer, the
  // receiver repaints a small code with its progress, how well it reads, and done once it has the file.
  const feedbackSession = multiCode && steerSender && (isScanning || receiverSuccess) ? sessionId : null;
  const fractionRef = useRef(0);
  const doneRef = useRef(false);
  useEffect(() => {
    fractionRef.current = fountainStats && fountainStats.k > 0 ? Math.min(1, fountainStats.rank / fountainStats.k) : 0;
    doneRef.current = receiverSuccess;
  }, [fountainStats, receiverSuccess]);
  useEffect(() => {
    if (!feedbackSession) return undefined;
    // A new random nonce per receive: it tells this receiver apart from others and names nobody.
    const nonce = crypto.getRandomValues(new Uint8Array(FEEDBACK_NONCE_BYTES));
    const feedbackSessionId = hexToBytes(feedbackSession);
    let cancelled = false;
    let encoder: QrSymbolEncoder | null = null;
    const paint = () => {
      const canvas = feedbackCanvasRef.current;
      if (!encoder || !canvas) return;
      const text = encodeFeedbackFrame({
        sessionId: feedbackSessionId,
        nonce,
        fractionDecoded: doneRef.current ? 1 : fractionRef.current,
        ...feedbackMeterRef.current.measure(),
        done: doneRef.current,
      });
      paintBeacon(canvas, encoder.create(text, { errorCorrectionLevel: 'M' }).modules);
    };
    loadQrEncoder().then(
      (loaded) => {
        if (cancelled) return;
        encoder = loaded;
        paint();
      },
      () => undefined
    );
    const timer = setInterval(paint, FEEDBACK_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [feedbackSession]);

  // Once a second, the multi-code receiver says which layer it reads and whether progress stalled.
  const hintActive = multiCode && isScanning && !receiverSuccess;
  useEffect(() => {
    if (!hintActive) {
      setLayerHintText(null);
      return undefined;
    }
    const timer = setInterval(() => {
      const recent = layerWindowRef.current;
      const since = lastProgressRef.current;
      const hint = layerHint({
        denseFrames: recent.filter((layer) => layer === 'dense').length,
        beaconFrames: recent.filter((layer) => layer === 'beacon').length,
        secondsWithoutProgress: since === null ? 0 : Math.floor((performance.now() - since) / 1000),
      });
      setLayerHintText((current) => (current === hint ? current : hint));
    }, 1000);
    return () => clearInterval(timer);
  }, [hintActive]);

  return {
    layerHint: layerHintText,
    steerSender,
    setSteerSender,
    feedbackActive: feedbackSession !== null,
    feedbackCanvasRef,
    recordFrameRead,
    noteManifest,
    noteProgress,
    recordDroplet,
    resetRate,
    reset,
  };
}
