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

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { analyseReceivedFile } from '@/packages/core/files';
import type { PrismManifestInfo } from '@/packages/optical-transfer';
import type { ReceivedBundleFile } from '@/packages/optical-transfer/client';
import type { AnnouncedTransfer } from '@/components/transfer/receive/ReceiveTelemetry';
import type { useToast } from '@/components/ui/Toast';
import { triggerFileDownload } from '@/utils/downloadManager';
import { playChime, vibrate } from '@/utils/feedback';

/**
 * What the sender announced, with its first file's sanitised name.
 * @param manifest - The manifest in view, or null.
 */
export function useAnnounced(manifest: PrismManifestInfo | null): AnnouncedTransfer | null {
  // The name comes from whoever is showing the stream: show the sanitised form.
  return useMemo(() => {
    if (!manifest) return null;
    // A private or multi-file transfer lists no single file up front.
    const file = manifest.files[0] ?? null;
    return { ...manifest, file, safeName: file ? analyseReceivedFile(file.name, file.mimeType).safeName : null };
  }, [manifest]);
}

/**
 * Saves every received file in one ZIP. The archive code loads only when it is needed.
 * @param bundle - The files of a finished multi-file transfer.
 * @param addToast - Tells the person when the archive could not be made.
 */
export function useSaveBundleZip(bundle: ReceivedBundleFile[] | null, addToast: ReturnType<typeof useToast>['addToast']) {
  return useCallback(async () => {
    if (!bundle) return;
    try {
      const { createZip } = await import('@/packages/core/zip');
      const zip = createZip(bundle.map((file) => ({ name: file.name, data: file.data })));
      triggerFileDownload(zip, 'qrcraftly-files.zip', 'application/zip');
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'The archive could not be made.', duration: 5000 });
    }
  }, [bundle, addToast]);
}

/**
 * A short buzz when the file arrives, and a chime only if the person turned sound on.
 * @param arrived - A transfer finished.
 * @returns The sound switch and its setter.
 */
export function useArrivalChime(arrived: boolean): [boolean, (on: boolean) => void] {
  const [soundOn, setSoundOn] = useState(false);
  // Reads the sound switch as it is when a transfer finishes. Flipping the switch afterwards must not replay it.
  const announceArrival = useEffectEvent(() => {
    vibrate([30, 50, 30]);
    if (soundOn) playChime();
  });
  useEffect(() => {
    if (!arrived) return;
    announceArrival();
  }, [arrived]);
  return [soundOn, setSoundOn];
}
