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

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { DEFAULT_TRANSFER_DENSITY, type TransferDensity } from '../fountain/session';
import { MULTI_RATE_PROFILES, type MultiRateProfileName } from '../multicode/multirate';
import { planMultiCode, type MultiCodePlan } from '../multicode/plan';
import type { BeaconPlan } from '../contracts';
import { tileScreenOf } from './tiles';
import type { OuterCode } from '../prism/session';

/** The multi-rate profile (#1143) that goes with each density, as the page's speed presets pair them. */
export const PROFILE_FOR_DENSITY: Readonly<Record<TransferDensity, MultiRateProfileName>> = { reliable: 'steady', balanced: 'balanced', fast: 'fast' };

/** How a new stream is shown, from the settings it starts with. */
export interface StreamPlan {
  /** The multi-code plan, or null for one code per frame. */
  plan: MultiCodePlan | null;
  beacon: BeaconPlan | null;
  /** The profile a steered stream starts on, or null when it is not steered. */
  profile: MultiRateProfileName | null;
  /** The frames a second a steered stream aims at, or null. */
  targetFps: number | null;
}

/**
 * Plans a new stream. A screen too small for 3 CSS px modules keeps one code per frame. The speed
 * profile of the same name as the density (#1143) prefers a layout and sets how often a beacon
 * comes; a steered stream (#1146) starts on that profile and runs at its pace.
 * @param canvas - The transfer canvas, or null before it mounts.
 * @param settings - The stream's settings.
 */
export function planStream(
  canvas: HTMLCanvasElement | null,
  { multiCode, steer, density, fps }: { multiCode: boolean; steer: boolean; density: TransferDensity; fps: number },
): StreamPlan {
  const profile = MULTI_RATE_PROFILES[PROFILE_FOR_DENSITY[density]];
  const plan = multiCode && canvas
    ? planMultiCode({ enabled: true, screen: tileScreenOf(canvas), refreshHz: 60, targetFps: fps, layoutId: profile.layoutId })
    : null;
  const beacon = plan && profile.beaconVersion > plan.layout.version ? { version: profile.beaconVersion, every: profile.beaconEvery } : null;
  const steered = plan !== null && steer;
  return { plan, beacon, profile: steered ? PROFILE_FOR_DENSITY[density] : null, targetFps: steered ? profile.targetFps : null };
}

/**
 * The sender's settings and the lock that holds them while a stream starts or runs.
 * @param settingsLocked - True from Start until the stream stops. A stream keeps the settings it was
 *   started with, so the switches cannot change while it starts or runs and never show something it is not doing.
 * @param settingsLockedRef - The lock as the setters read it; Start and Stop also set it at once.
 */
export function useSenderSettings(settingsLocked: boolean, settingsLockedRef: RefObject<boolean>) {
  /** Encrypt the next transfer under a key code (#1144). */
  const [isPrivate, setIsPrivateState] = useState(false);
  const [density, setDensityState] = useState<TransferDensity>(DEFAULT_TRANSFER_DENSITY);
  /** The code to send with: the LT code by default, the outer code (#1141) when chosen under Advanced. */
  const [outerCode, setOuterCodeState] = useState<OuterCode>('lt');
  /** Several codes per frame (#1142), chosen under Advanced. Off by default. */
  const [multiCode, setMultiCodeState] = useState(false);
  /** Let the receiver steer the speed through the webcam (#1146), chosen under Advanced. Off by default. */
  const [steer, setSteerSetting] = useState(false);
  /** Sends real BC-UR parts that wallets can read, in place of Prism (#1149). */
  const [walletCompat, setWalletCompatState] = useState(false);
  const [fps, setFps] = useState(15);

  useEffect(() => {
    settingsLockedRef.current = settingsLocked;
  }, [settingsLocked, settingsLockedRef]);
  const setters = useMemo(() => {
    const unlessLocked =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (!settingsLockedRef.current) set(value);
      };
    return {
      setIsPrivate: unlessLocked(setIsPrivateState),
      setDensity: unlessLocked(setDensityState),
      setOuterCode: unlessLocked(setOuterCodeState),
      setMultiCode: unlessLocked(setMultiCodeState),
      setSteer: unlessLocked(setSteerSetting),
      setWalletCompat: unlessLocked(setWalletCompatState),
    };
  }, [settingsLockedRef]);

  return { isPrivate, density, outerCode, multiCode, steer, walletCompat, fps, setFps, ...setters };
}
