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

import type { HandshakeInfo } from '../contracts';
import type { PrismManifestInfo } from '../prism/manifest';

export type ReceiverToast = {
  type: 'success' | 'info' | 'error' | 'warning';
  message: string;
  duration?: number;
};

/** Hands a verified file to the user. Injected by the page (e.g. the app's download manager). */
export type ReceivedFileSaver = (data: Uint8Array, fileName: string, mimeType: string) => void;

export interface UseOpticalReceiverOptions {
  /** Saves a verified file. */
  saveFile: ReceivedFileSaver;
  addToast?: (toast: ReceiverToast) => void;
  autoDownload?: boolean;
  initialMode?: 'camera' | 'file';
}

/** One finished file as the worker posts it. */
export interface WorkerFile {
  buffer: ArrayBuffer;
  handshake: HandshakeInfo;
}

/** Messages posted by the reassembly worker. */
export interface ReassemblyWorkerMessage {
  type?: 'PROGRESS' | 'COMPLETE' | 'ERROR' | 'MANIFEST' | 'KEY_STATUS' | 'SWITCH_OFFER';
  progress?: number;
  current?: number;
  total?: number;
  buffer?: ArrayBuffer;
  error?: string;
  handshake?: HandshakeInfo | null;
  isFountain?: boolean;
  /** Key of the session that just completed. */
  session?: string | null;
  rank?: number;
  dropletsReceived?: number;
  /** The transfer's manifest, announced as soon as it is accepted. */
  manifest?: PrismManifestInfo;
  /** With MANIFEST: the transfer is private and still waiting for its key code. */
  needsKey?: boolean;
  /** With KEY_STATUS: whether the key code was readable. */
  accepted?: boolean;
  /** With SWITCH_OFFER: another stream in view. */
  offer?: PrismManifestInfo;
  /** With COMPLETE: the files of a bundle. */
  files?: WorkerFile[];
}
