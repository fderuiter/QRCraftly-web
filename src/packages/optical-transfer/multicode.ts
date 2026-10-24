/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
 * Multi-code transfer (#1142). Experimental and off unless a caller opts in through
 * `planMultiCode`; the app reaches it only behind preview switches.
 */

export {
  MIN_MODULE_CSS_PX,
  TILE_QUIET_MODULES,
  TILE_LAYOUTS,
  alphanumericCapacityL,
  qrModuleCount,
  tileFrameCapacity,
  tileSymbolPlan,
  layoutFootprint,
  modulePxFor,
  selectLayout,
  type TileLayout,
  type TileLayoutId,
  type TileSymbolPlan,
  type ScreenSize,
  type LayoutChoice,
  type LayoutOptions,
} from './lib/multicode/layout';
export {
  tileGroup,
  tileSlot,
  tileFrameIndex,
  tilesChangingAt,
  tilesIntactAcross,
  worstIntactFraction,
} from './lib/multicode/stagger';
export {
  measureRefreshInterval,
  refreshRateFromInterval,
  holdForTargetFps,
  effectiveFps,
  createVsyncPacer,
  type PacerTick,
  type FrameClock,
  type VsyncPacer,
  type VsyncPacerOptions,
} from './lib/multicode/pacing';
export {
  TileTracker,
  predictTileRects,
  createSymbolDedup,
  type Rect,
  type TileCrop,
  type TrackPlan,
  type CropResult,
  type SymbolDedup,
  type TileTrackerOptions,
} from './lib/multicode/tracker';
export {
  decoderPoolSize,
  createDecoderPool,
  type DecoderPool,
  type DecoderPoolOptions,
  type DecoderPoolStats,
  type PoolSizeOptions,
} from './lib/multicode/pool';
export { planMultiCode, type MultiCodeOptions, type MultiCodePlan } from './lib/multicode/plan';
export {
  createTileReader,
  layoutForCodes,
  TileReadSession,
  type TilePlan,
  type TileReader,
  type TileReaderOptions,
  type TileVideoSource,
  type TileWorker,
} from './lib/receiver/tileReader';
export type { TileCode, TileReadRequest, TileReadResponse } from './lib/receiver/tileContracts';
export {
  MULTI_RATE_PROFILES,
  isBeaconFrame,
  frameLayer,
  createMultiRateSender,
  type MultiRateProfile,
  type MultiRateProfileName,
  type MultiRateFrame,
  type MultiRateSender,
  type MultiRateSenderOptions,
} from './lib/multicode/multirate';
export {
  layerHint,
  ROBUST_LAYER_HINT,
  STALL_HINT,
  STALL_HINT_SECONDS,
  type LayerObservation,
} from './lib/multicode/layerHint';
