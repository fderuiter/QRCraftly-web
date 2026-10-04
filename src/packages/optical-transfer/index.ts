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
 * Optical Transfer Engine — Primary Root Entry Point
 * Consolidates screen-to-camera optical file transfer, rateless fountain codes,
 * frame memory pooling, and protocol lookahead behind minimal entry-point seams.
 */

export {
  verifyHandshakeFrame,
  HANDSHAKE_WATCHDOG_MS,
  type HandshakeVerifierDeps,
  type HandshakeCheckRequest,
  type HandshakeFrameVerifier,
} from './lib/handshake';

export { PreallocatedFramePool, shuffleInPlace } from './lib/framePool';

export { type HandshakeInfo, type TransferStats } from './lib/contracts';

export { FountainEncoder } from './lib/fountain/encoder';
export { FountainDecoder } from './lib/fountain/decoder';
export { solveGF2, type GF2Equation, type GF2Solution } from './lib/fountain/gf2';
export {
  buildRobustSolitonCdf,
  sampleDegreeFromCdf,
  getNeighborsForSeq,
  createPrng,
} from './lib/fountain/soliton';
export {
  serializeDroplet,
  parseDropletString,
  isFountainDropletString,
} from './lib/fountain/envelope';
export { cborEncode, cborDecode, type CborValue } from './lib/fountain/cbor';
export { encodeBytewordsMinimal, decodeBytewordsMinimal } from './lib/fountain/bytewords';
export { crc32, crc32c, crc32Hex } from './lib/fountain/crc32';
export {
  type DropletMetadata,
  type FountainDroplet,
  type FountainEncoderOptions,
} from './lib/fountain/contracts';
export {
  createFountainSession,
  openFountainSession,
  encodeSessionMessage,
  decodeSessionMessage,
  compressForTransfer,
  decompressTransferPayload,
  resolveFountainSymbolSize,
  resolveTransferDensity,
  TRANSFER_DENSITY_PROFILES,
  DEFAULT_TRANSFER_DENSITY,
  maxDropletStringLength,
  sha256Hex,
  MAX_QR_VERSION,
  type FountainSessionHeader,
  type FountainSessionOptions,
  type TransferCompression,
  type TransferDensity,
  type TransferDensityProfile,
  type StreamErrorCorrection,
} from './lib/fountain/session';
export {
  MAX_BUNDLE_ENTRIES,
  MAX_RECEIVE_BYTES,
  MAX_RECEIVE_MESSAGE_BYTES,
} from './lib/limits';
export {
  FountainReassembler,
  FountainRateTracker,
  type FountainProgress,
  type FountainTelemetry,
} from './lib/fountain/reassembler';

export { encodeBase45, decodeBase45, base45Length } from './lib/prism/base45';
export {
  PRISM_VERSION,
  FLAG_ENCRYPTED,
  FRAME_OVERHEAD,
  encodeDataFrame,
  encodeManifestFrame,
  decodeFrame,
  looksLikePrismFrame,
  type PrismFrame,
  type FrameRejection,
  type FrameDecodeResult,
} from './lib/prism/frame';
export {
  MAX_MANIFEST_NAME_BYTES,
  encodeManifest,
  decodeManifest,
  sessionIdOf,
  fitFileName,
  type PrismManifest,
  type PrismFileEntry,
  type PrismManifestInfo,
  type ManifestResult,
  type ManifestRejection,
} from './lib/prism/manifest';
export {
  MANIFEST_INTERVAL,
  PrismStream,
  createPrismSession,
  createPrismBundleSession,
  prismFrameCapacity,
  prismSymbolSize,
  estimateTransferFrames,
  type PrismStreamOptions,
  type PrismSessionOptions,
} from './lib/prism/session';
export { packBundle, unpackBundle, sanitizeRelativePath, type BundleSource, type BundleFile } from './lib/prism/bundle';
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
export { bytesToWords, wordsToBytes, fingerprintWords, formatKeyCode, parseKeyCode, keyQrText, parseKeyQr, KEY_CODE_WORDS, KEY_SECRET_BYTES } from './lib/prism/words';
