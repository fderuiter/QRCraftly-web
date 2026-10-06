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

/**
 * The one switch for multi-code transfer (#1142). Nothing outside this package calls it yet: the
 * sender keeps showing one small code per frame unless a caller passes `enabled: true`.
 */
import { MIN_MODULE_CSS_PX, TILE_LAYOUTS, modulePxFor, selectLayout, type LayoutOptions, type ScreenSize, type TileLayout, type TileLayoutId } from './layout';
import { effectiveFps, holdForTargetFps } from './pacing';
import { decoderPoolSize } from './pool';
import { worstIntactFraction } from './stagger';

export interface MultiCodeOptions {
  /** Off unless exactly `true`. */
  enabled?: boolean;
  /** Sender screen in CSS pixels. */
  screen: ScreenSize;
  /** Measured display refresh rate in hertz. */
  refreshHz: number;
  /** Frame rate to aim for, never exceeded (default 30). */
  targetFps?: number;
  /** "single" asks for one large code (a distant camera). */
  prefer?: LayoutOptions['prefer'];
  /** A layout to use when it fits the screen, as a speed profile asks (#1143); otherwise the screen picks. */
  layoutId?: TileLayoutId;
  /** The receiver's `navigator.hardwareConcurrency`. */
  hardwareConcurrency?: number;
}

export interface MultiCodePlan {
  layout: TileLayout;
  /** CSS pixels per module. */
  modulePx: number;
  /** Whole display refreshes each frame is held for. */
  hold: number;
  /** Frames per second that gives on this display. */
  fps: number;
  /** True when the diagonal tile groups change on alternate refreshes. */
  staggered: boolean;
  /** Smallest share of tiles a torn frame keeps. */
  worstIntactFraction: number;
  /** Decoder workers the receiver should run. */
  poolSize: number;
  /** What the display side can carry per second, before coding overhead, losses and the camera. Not a measurement. */
  ceilingBytesPerSecond: number;
}

/**
 * Plans a multi-code transfer.
 * @param options - Screen, refresh rate and the opt-in.
 * @returns The plan, or null when multi-code is off or no layout fits the screen at 3 CSS px per
 * module (the caller then keeps today's single-code stream).
 */
export function planMultiCode(options: MultiCodeOptions): MultiCodePlan | null {
  if (options.enabled !== true) return null;
  const wanted = options.layoutId ? TILE_LAYOUTS[options.layoutId] : null;
  const wantedPx = wanted ? modulePxFor(wanted, options.screen) : 0;
  const choice = wanted && wantedPx >= MIN_MODULE_CSS_PX ? { layout: wanted, modulePx: wantedPx } : selectLayout(options.screen, { prefer: options.prefer });
  if (!choice) return null;
  const hold = holdForTargetFps(options.refreshHz, options.targetFps ?? 30);
  const fps = effectiveFps(options.refreshHz, hold);
  return {
    layout: choice.layout,
    modulePx: choice.modulePx,
    hold,
    fps,
    staggered: choice.layout.tiles > 1 && hold > 1,
    worstIntactFraction: worstIntactFraction(choice.layout, hold),
    poolSize: decoderPoolSize(options.hardwareConcurrency),
    ceilingBytesPerSecond: Math.round(choice.layout.payloadPerFrame * fps),
  };
}
