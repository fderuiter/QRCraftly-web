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

import type React from 'react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { CameraInfo } from '@/packages/optical-scanner/client';
import { unlockChime } from '@/utils/feedback';

export interface ReceiveOptionsProps {
  soundOn: boolean;
  onSoundChange: (on: boolean) => void;
  /** Read several codes per camera frame (#1142). */
  multiCode: boolean;
  onMultiCodeChange: (on: boolean) => void;
  /** The streaming camera's size and frame rate, or null. */
  camera: CameraInfo | null;
  /** Which layer the camera reads, or that progress stalled (#1143). */
  layerHint: string | null;
  steerSender: boolean;
  onSteerSenderChange: (on: boolean) => void;
  /** The feedback code is shown (#1146). */
  feedbackActive: boolean;
  feedbackCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * The receiver's switches: the arrival chime, the multi-code reader with its hint, and the
 * feedback code that lets the sender steer, painted in a corner while it is on.
 * @returns The options.
 */
export function ReceiveOptions({ soundOn, onSoundChange, multiCode, onMultiCodeChange, camera, layerHint, steerSender, onSteerSenderChange, feedbackActive, feedbackCanvasRef }: ReceiveOptionsProps) {
  return (
    <>
      <ToggleSwitch id="receive-sound" label="Play a chime when the file arrives" checked={soundOn}
        onChange={(on) => {
          // The switch is the gesture iOS needs before the chime can play later.
          if (on) unlockChime();
          onSoundChange(on);
        }}
      />

      <div className="space-y-1">
        <ToggleSwitch id="receive-multi-code" label="Read several codes per frame (preview)" checked={multiCode} onChange={onMultiCodeChange} />
        <p className="text-xs text-fg-muted" data-testid="receive-multi-code-hint">
          {multiCode && camera && camera.width > 0
            ? `The camera streams ${camera.width}×${camera.height}${camera.frameRate > 0 ? ` at ${Math.round(camera.frameRate)} frames/sec` : ''}.`
            : 'For a sender showing several codes at once. Asks the camera for 60 frames a second.'}
        </p>
        {multiCode && (
          <p role="status" className="text-sm font-medium text-fg" data-testid="layer-hint">
            {layerHint ?? ''}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <ToggleSwitch
          id="receive-steer"
          label="Help the sender pick its speed (preview)"
          checked={steerSender && multiCode}
          onChange={onSteerSenderChange}
          disabled={!multiCode}
        />
        <p className="text-xs text-fg-muted" data-testid="receive-steer-hint">
          {multiCode
            ? 'Shows a small code in the corner of this screen with how well this device reads, so a sender with “Let the receiver steer” on can change speed and stop once you have the file. Keep that corner in view of the sender’s camera.'
            : 'Needs “Read several codes per frame”.'}
        </p>
      </div>

      {/* The feedback code sits in a corner, where the sender's webcam can see it. */}
      {feedbackActive && (
        <canvas
          ref={feedbackCanvasRef}
          className="fixed right-4 bottom-4 z-50 size-32 rounded-lg bg-surface shadow-overlay"
          role="img"
          aria-label="Feedback code for the sender"
          data-testid="feedback-code"
          width={256}
          height={256}
        />
      )}
    </>
  );
}
