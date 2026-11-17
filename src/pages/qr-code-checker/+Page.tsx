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

import { CloudUpload, Gamepad2, ShieldCheck } from 'lucide-react';
import { QRChecker } from '@/components/QRChecker';
import { ScannerPageLayout, type ScannerRelatedLink } from '@/components/scanner/ScannerPageLayout';
import { openInGenerator } from '@/utils/scanHandover';

/** The plain promises under the checker, each backed by how it works. */
const PROMISES = [
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'The picture is read on this device and never sent anywhere.' },
  { icon: ShieldCheck, title: 'Links checked first', text: 'See the real address before opening a link. Script links are blocked.' },
  { icon: Gamepad2, title: 'Test durability too', text: 'The Arcade knocks holes in a code to show how much damage it survives.' },
] as const;

const RELATED_LINKS: readonly ScannerRelatedLink[] = [
  { href: '/arcade', label: 'Stress-test a code in the Arcade' },
  { href: '/qr-code-scanner', label: 'Scan a code with your camera' },
  { href: '/', label: 'Make your own QR code' },
];

/**
 * Standalone QR code checker (/qr-code-checker, #1036): upload, drop or paste a picture of any
 * QR code and get a scannability report plus what it holds.
 * @returns The page.
 */
export default function Page() {
  return (
    <ScannerPageLayout
      toolId="qr-code-checker"
      description="Find out what a QR code holds and whether it will scan, even after print blur. No sign-up, and nothing leaves your browser."
      promises={PROMISES}
      relatedLinks={RELATED_LINKS}
    >
      <QRChecker onEdit={openInGenerator} />
    </ScannerPageLayout>
  );
}
