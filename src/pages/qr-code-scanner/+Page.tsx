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

import { Camera, CloudUpload, ShieldCheck } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import { copy } from '@/data/copy/qr-code-scanner';
import { ScannerPageLayout, type ScannerRelatedLink } from '@/components/scanner/ScannerPageLayout';
import { openInGenerator } from '@/utils/scanHandover';

/** The plain promises under the scanner, each backed by how the scanner works. */
const PROMISES = [
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'Camera video and images are read on this device and never sent anywhere.' },
  { icon: Camera, title: 'Camera only on request', text: 'The camera starts when you press Start camera and stops when a code is found.' },
  { icon: ShieldCheck, title: 'Links checked first', text: 'See the real address before opening a link. Script links are blocked.' },
] as const;

const RELATED_LINKS: readonly ScannerRelatedLink[] = [
  { href: '/', label: 'Make your own QR code' },
  { href: '/file-transfer/receive', label: 'Receive a file over QR codes' },
  { href: '/security', label: 'How QRCraftly protects your data' },
];

/**
 * Standalone QR code scanner (/qr-code-scanner, #1034): camera scanning that starts only on
 * request, image scanning by file, paste or drop, the safe result sheet, and the how-to, privacy
 * and FAQ content.
 * @returns The page.
 */
export default function Page() {
  return (
    <ScannerPageLayout
      toolId="qr-code-scanner"
      description="Scan a QR code with your camera, or from a photo or screenshot. No app and no sign-up, and nothing leaves your browser."
      promises={PROMISES}
      copy={copy}
      relatedLinks={RELATED_LINKS}
    >
      <QRScanner autoStartCamera={false} onEdit={openInGenerator} editLabel="Open in generator" />
    </ScannerPageLayout>
  );
}
