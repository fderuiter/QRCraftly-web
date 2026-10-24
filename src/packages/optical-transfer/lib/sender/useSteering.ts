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

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { TileLayoutId } from '../multicode/layout';
import { MULTI_RATE_PROFILES, type MultiRateProfileName } from '../multicode/multirate';
import { planMultiCode, type MultiCodePlan } from '../multicode/plan';
import { createSpeedController, switchableProfile, type ControllerDecision, type SpeedController } from '../feedback/controller';
import { createFeedbackLink, type CameraPermission, type FeedbackLink, type FeedbackLinkState } from '../feedback/link';
import { decodeFrame } from '../prism/frame';
import { spawnTileWorker } from '../receiver/media';
import { permissionOf } from '../camera';
import { createTileReader, type TileReader } from '../receiver/tileReader';
import { tileScreenOf } from './tiles';
import type { SenderRefs } from './senderRefs';
import type { SenderTileInfo } from './senderTypes';

export interface SteeringOptions {
  /** Opens the sending device's webcam; without it, steering is unavailable. */
  requestWebcam: (() => Promise<MediaStream>) | undefined;
  /** Called when every receiver the webcam can see has the file. */
  onAllDone: () => void;
  /** Starts the tile loop for a new layout. */
  runTileLoop: (plan: MultiCodePlan) => void;
  setTileInfo: Dispatch<SetStateAction<SenderTileInfo | null>>;
}

/**
 * The webcam back channel (#1146): the camera stream, the feedback reader, the 100 ms steer
 * interval and the speed switches it asks for. Moved from `useOpticalSender` (#1511).
 * @param refs - The sender's shared refs.
 * @param options - The webcam opener and what to do when the receivers are done.
 */
export function useSteering(refs: SenderRefs, { requestWebcam, onAllDone, runTileLoop, setTileInfo }: SteeringOptions) {
  const {
    canvasRef, workerRef, framePoolRef, isTransferringRef, isPausedRef, tilePlanRef, holdRef, tileShownRef,
    lastDenseRef, beaconPlanRef, beaconPoolRef, beaconShownRef, targetFpsRef, profileRef, switchingRef,
    refreshBaseRef, lastRefreshRef, pacerRef,
  } = refs;
  /** The back channel: off, asking for the webcam, listening, or one-way after a refusal or loss. */
  const [steerState, setSteerState] = useState<FeedbackLinkState>({ status: 'off' });
  /** The profile a steered transfer shows now, or null. */
  const [steeredProfile, setSteeredProfile] = useState<MultiRateProfileName | null>(null);
  /** Receivers whose feedback code the webcam reads. */
  const [steeringReceivers, setSteeringReceivers] = useState(0);

  const requestWebcamRef = useRef(requestWebcam);
  const onAllDoneRef = useRef(onAllDone);
  const linkRef = useRef<FeedbackLink | null>(null);
  const controllerRef = useRef<SpeedController | null>(null);
  const webcamRef = useRef<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);
  const feedbackReaderRef = useRef<TileReader | null>(null);
  const steerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Removes the back channel's visibility listener. */
  const stopWatchingVisibilityRef = useRef<(() => void) | null>(null);
  /** Applies a speed decision; set below, read by the webcam reader and the steering timer. */
  const applyDecisionRef = useRef<(decision: ControllerDecision) => void>(() => {});

  /** Turns the back channel off and lets the webcam go. */
  const endSteering = useCallback(() => {
    stopWatchingVisibilityRef.current?.();
    stopWatchingVisibilityRef.current = null;
    if (steerTimerRef.current) clearInterval(steerTimerRef.current);
    steerTimerRef.current = null;
    feedbackReaderRef.current?.stop();
    feedbackReaderRef.current = null;
    linkRef.current?.disable();
    linkRef.current = null;
    controllerRef.current = null;
    switchingRef.current = null;
  }, [switchingRef]);

  /** Ends steering and clears what the page shows of it, as a stopped stream needs. */
  const resetSteering = useCallback(() => {
    endSteering();
    setSteerState({ status: 'off' });
    setSteeredProfile(null);
    setSteeringReceivers(0);
    profileRef.current = null;
    targetFpsRef.current = null;
  }, [endSteering, profileRef, targetFpsRef]);

  /** Asks the worker for a profile's layout; the stream changes over when SWITCHED comes back. */
  const requestSwitch = useCallback((name: MultiRateProfileName) => {
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker || switchingRef.current) return;
    const profile = switchableProfile(name);
    const plan = planMultiCode({ enabled: true, screen: tileScreenOf(canvas), refreshHz: 60, targetFps: profile.targetFps, layoutId: profile.layoutId });
    // A screen too small for the profile's layout stays where it is.
    if (!plan || plan.layout.id !== profile.layoutId) return;
    const beacon = profile.beaconVersion > plan.layout.version ? { version: profile.beaconVersion, every: profile.beaconEvery } : null;
    switchingRef.current = { plan, beacon, profile: name };
    worker.postMessage({ type: 'SWITCH', payload: { tiles: plan.layout.id, beacon: beacon ?? undefined } });
  }, [canvasRef, workerRef, switchingRef]);

  /** Shows the new layout from its first frame once the worker has switched. */
  const finishSwitch = useCallback((tiles: TileLayoutId) => {
    const next = switchingRef.current;
    if (!next || next.plan.layout.id !== tiles) return;
    pacerRef.current?.stop();
    pacerRef.current = null;
    framePoolRef.current.clear();
    tileShownRef.current = [];
    lastDenseRef.current = [];
    beaconPoolRef.current.clear();
    beaconShownRef.current = null;
    refreshBaseRef.current = 0;
    lastRefreshRef.current = -1;
    tilePlanRef.current = next.plan;
    beaconPlanRef.current = next.beacon;
    targetFpsRef.current = MULTI_RATE_PROFILES[next.profile].targetFps;
    holdRef.current = 1;
    profileRef.current = next.profile;
    switchingRef.current = null;
    setSteeredProfile(next.profile);
    setTileInfo({ layout: next.plan.layout.id, hold: null, refreshHz: null });
    if (isTransferringRef.current && !isPausedRef.current) runTileLoop(next.plan);
  }, [runTileLoop, setTileInfo, switchingRef, pacerRef, framePoolRef, tileShownRef, lastDenseRef, beaconPoolRef, beaconShownRef, refreshBaseRef, lastRefreshRef, tilePlanRef, beaconPlanRef, targetFpsRef, holdRef, profileRef, isTransferringRef, isPausedRef]);

  /** Follows the speed controller: stops once every receiver is done, else shows the profile it asks for. */
  const applyDecision = useCallback((decision: ControllerDecision) => {
    const link = linkRef.current;
    const current = profileRef.current;
    if (!link || !current) return;
    setSteeringReceivers(decision.receivers);
    if (link.shouldStop(decision.stop)) {
      onAllDoneRef.current();
      return;
    }
    const wanted = link.profileFor(current, decision.profile);
    if (wanted !== current) requestSwitch(wanted);
  }, [requestSwitch, profileRef]);

  /**
   * Opens the back channel for a steerable transfer: asks for the webcam, then reads the receivers'
   * feedback codes with one decoder worker and runs the controller's timers every 100 ms.
   */
  const startSteering = useCallback((sessionId: string) => {
    endSteering();
    const initial = profileRef.current ?? 'balanced';
    const controller = createSpeedController({ sessionId, initial });
    // This link's own camera. It becomes the shared webcam only once the link is listening, so a
    // grant that arrives after a restart stops its own stream, never the newer transfer's (#1293).
    let webcam: { stream: MediaStream; video: HTMLVideoElement } | null = null;
    const releaseCamera = () => {
      const mine = webcam;
      webcam = null;
      if (mine && webcamRef.current === mine) webcamRef.current = null;
      mine?.stream.getTracks().forEach((track) => track.stop());
      if (mine) mine.video.srcObject = null;
    };
    const requestCamera = async (): Promise<CameraPermission> => {
      const open = requestWebcamRef.current;
      if (!open) return 'unavailable';
      let stream: MediaStream;
      try {
        stream = await open();
      } catch (error) {
        return permissionOf(error);
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      webcam = { stream, video };
      try {
        await video.play();
      } catch {
        // A video that will not autoplay still delivers frames once it can; the reader waits for them.
      }
      return 'granted';
    };
    const link = createFeedbackLink({ requestCamera, releaseCamera });
    linkRef.current = link;
    controllerRef.current = controller;
    setSteerState({ status: 'requesting' });
    void link.enable().then((state) => {
      if (linkRef.current !== link) return;
      setSteerState(state);
      if (state.status !== 'listening') return;
      webcamRef.current = webcam;
      const reader = createTileReader({
        getVideo: () => webcamRef.current?.video ?? null,
        poolSize: 1,
        onText: () => undefined,
        onFrameRead: (codes) => {
          for (const code of codes) {
            const decoded = decodeFrame(code.text);
            if (!decoded.ok || decoded.frame.type !== 'feedback') continue;
            applyDecisionRef.current(controller.report(decoded.frame, decoded.frame.sessionId, performance.now()));
          }
        },
        spawnWorker: spawnTileWorker,
      });
      feedbackReaderRef.current = reader;
      reader.start();
      // The back-channel webcam follows the Camera Session's rule (ADR 0016): it is let go while
      // the tab is hidden and asked for again when the tab is shown (#1585).
      let hidden = false;
      // One request at a time, so a quick hide and show cannot open a second stream.
      let asking = false;
      const onVisibilityChange = () => {
        if (linkRef.current !== link || link.state.status !== 'listening') return;
        if (document.hidden) {
          hidden = true;
          reader.stop();
          releaseCamera();
          return;
        }
        if (!hidden || asking) return;
        asking = true;
        void requestCamera().then((permission) => {
          asking = false;
          if (linkRef.current !== link || link.state.status !== 'listening') {
            releaseCamera();
            return;
          }
          if (document.hidden) {
            // Hidden again before the camera answered: keep waiting for the tab to be shown.
            releaseCamera();
            return;
          }
          hidden = false;
          if (permission !== 'granted') {
            link.cameraLost();
            setSteerState(link.state);
            return;
          }
          webcamRef.current = webcam;
          reader.start();
        });
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      stopWatchingVisibilityRef.current = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        releaseCamera();
      };
      steerTimerRef.current = setInterval(() => {
        // A hidden tab has no camera on purpose; the controller waits until it is shown.
        if (hidden) return;
        const live = webcamRef.current?.stream.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
        if (!live) {
          // The camera went away: carry on one way with the profile on screen, and no auto-stop.
          link.cameraLost();
          setSteerState(link.state);
          feedbackReaderRef.current?.stop();
          if (steerTimerRef.current) clearInterval(steerTimerRef.current);
          steerTimerRef.current = null;
          return;
        }
        applyDecisionRef.current(controller.tick(performance.now()));
      }, 100);
    });
  }, [endSteering, profileRef]);

  useEffect(() => {
    requestWebcamRef.current = requestWebcam;
    onAllDoneRef.current = onAllDone;
    applyDecisionRef.current = applyDecision;
  }, [requestWebcam, onAllDone, applyDecision]);

  // The webcam and the reader are released on unmount.
  useEffect(() => endSteering, [endSteering]);

  return {
    steerState, steeredProfile, setSteeredProfile, steeringReceivers,
    startSteering, finishSwitch, resetSteering,
  };
}
