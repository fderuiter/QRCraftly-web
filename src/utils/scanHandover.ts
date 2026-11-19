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

import { navigate } from 'vike/client/router';
import type { ScanDescription } from '@/components/scanner/describeScan';
import { QR_TYPE_ROUTES } from '@/data/navigation';
import { stageGeneratorContent } from '@/context/QRContext';
import { acceptIncomingContent } from '@/components/inputs/retainedDrafts';

/**
 * Opens a scanned or checked code in the generator for its type. The content is handed over in memory
 * for the client-side navigation, never in the URL.
 * @param scan - The scanned or checked code description.
 */
export function openInGenerator(scan: ScanDescription): void {
  stageGeneratorContent({ type: scan.type, value: scan.text });
  acceptIncomingContent(scan.type);
  // nosemgrep: require-isdangerousurl -- an internal route from a fixed table, not scanned text
  void navigate(QR_TYPE_ROUTES[scan.type]);
}
