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
 * The Prism wire format, its codecs and the transfer machinery (#1602): fountain and outer
 * codes, CBOR, Bytewords, Base45, frames, manifests, sessions, bundles, keys and the receiver,
 * then the sender and receiver state machines, the handshake gate, the frame pool, progress and
 * camera helpers. For tests and tools; the app uses the pieces it needs through index.ts and
 * client.ts.
 */

export { FountainEncoder } from './lib/fountain/encoder';
export { FountainDecoder } from './lib/fountain/decoder';
export {
  FecEncoder,
  FecDecoder,
  loadFecModule,
  planBlocks,
  isValidFecLayout,
  type FecLayout,
  type FecSymbol,
  type FecEncoderOptions,
} from './lib/fec/codec';
export { solveGF2, type GF2Equation, type GF2Solution } from './lib/fountain/gf2';
export {
  buildRobustSolitonCdf,
  sampleDegreeFromCdf,
  getNeighborsForSeq,
  createPrng,
} from './lib/fountain/soliton';
export { cborEncode, cborDecode, type CborValue } from './lib/fountain/cbor';
export { encodeBytewordsMinimal, decodeBytewordsMinimal } from './lib/fountain/bytewords';
export { crc32, crc32c, crc32Hex } from '@/packages/core/checksum';
export type { DropletMetadata, FountainDroplet, FountainEncoderOptions } from './lib/fountain/contracts';
export {
  compressForTransfer,
  decompressTransferPayload,
  resolveTransferDensity,
  DEFAULT_TRANSFER_DENSITY,
  type FountainSessionHeader,
  type TransferCompression,
  type TransferDensityProfile,
  type StreamErrorCorrection,
} from './lib/fountain/session';
export {
  MAX_BUNDLE_ENTRIES,
  MAX_RECEIVE_BYTES,
  MAX_FEC_SOURCE_SYMBOLS,
  MAX_FEC_SYMBOL_BYTES,
} from './lib/limits';
export { FountainReassembler, FountainRateTracker, type FountainProgress } from './lib/fountain/reassembler';
export { encodeBase45, decodeBase45, base45Length } from './lib/prism/base45';
export {
  PRISM_VERSION,
  FLAG_BEACON,
  FLAG_ENCRYPTED,
  FLAG_OUTER_CODE,
  FRAME_OVERHEAD,
  encodeDataFrame,
  encodeManifestFrame,
  encodeFeedbackFrame,
  createReceiverNonce,
  decodeFrame,
  looksLikePrismFrame,
  type PrismFrame,
  type FeedbackLayer,
  type FeedbackReport,
  type FrameRejection,
  type FrameDecodeResult,
} from './lib/prism/frame';
export {
  MAX_MANIFEST_NAME_BYTES,
  MANIFEST_VERSION_FEC,
  MAX_FEC_BLOCKS,
  encodeManifest,
  decodeManifest,
  sessionIdOf,
  fitFileName,
  type PrismManifest,
  type PrismFileEntry,
  type ManifestResult,
  type ManifestRejection,
} from './lib/prism/manifest';
export {
  MANIFEST_INTERVAL,
  PrismStream,
  createPrismBundleSession,
  prismFrameCapacity,
  prismSymbolSize,
  type PrismStreamOptions,
  type RestreamOptions,
  type PrismSessionOptions,
} from './lib/prism/session';
export {
  packBundle,
  unpackBundle,
  sanitizeRelativePath,
  type BundleSource,
  type BundleFile,
} from './lib/prism/bundle';
export {
  hmacSha256,
  hkdfSha256,
  deriveKeys,
  privateSessionId,
  encryptBlock,
  decryptBlock,
  generateSecret,
  type PrivateKeys,
} from './lib/prism/crypto';
export {
  bytesToWords,
  wordsToBytes,
  fingerprintWords,
  formatKeyCode,
  parseKeyCode,
  keyQrText,
  parseKeyQr,
  KEY_CODE_WORDS,
  KEY_SECRET_BYTES,
} from './lib/prism/words';
export { PrismReceiver, OUTER_CODE_UNAVAILABLE } from './lib/prism/receiver';
export {
  verifyHandshakeFrame,
  HANDSHAKE_WATCHDOG_MS,
  type HandshakeVerifierDeps,
  type HandshakeCheckRequest,
  type HandshakeFrameVerifier,
} from './lib/handshake';
export { PreallocatedFramePool, shuffleInPlace } from './lib/framePool';
export type { HandshakeInfo, TransferStats } from './lib/contracts';
export type { DurationStyle } from './lib/format';
export { transferProgress, fountainStatsFrom, type TransferProgress } from './lib/progress';
export { permissionOf } from './lib/camera';
export { validateReceivedFile, type UploadedFile } from './lib/receiver/videoFile';
export {
  senderReducer,
  INITIAL_SENDER_STATE,
  type SenderEvent,
  type SenderState,
} from './lib/sender/machine';
export {
  receiverReducer,
  initialReceiverState,
  type ReceiverMode,
  type ReceiverEvent,
  type ReceiverState,
} from './lib/receiver/machine';
