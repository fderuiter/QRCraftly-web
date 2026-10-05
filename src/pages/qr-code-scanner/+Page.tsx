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
import { Camera, CloudUpload, ShieldCheck } from 'lucide-react';
import { QRScanner } from '@/components/QRScanner';
import type { ScanDescription } from '@/components/scanner/describeScan';
import { SidebarContent } from '@/components/SidebarContent';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { usePageContent } from '@/data/PageContentContext';
import { copy } from '@/data/copy/qr-code-scanner';
import { QR_TYPE_ROUTES } from '@/data/navigation';
import { stageGeneratorContent } from '@/context/QRContext';

/** The plain promises under the scanner, each backed by how the scanner works. */
const PROMISES = [
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'Camera video and images are read on this device and never sent anywhere.' },
  { icon: Camera, title: 'Camera only on request', text: 'The camera starts when you press Start camera and stops when a code is found.' },
  { icon: ShieldCheck, title: 'Links checked first', text: 'See the real address before opening a link. Script links are blocked.' },
] as const;

const RELATED_LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/**
 * Opens a scanned code in the generator for its type. The content is handed over in memory
 * for the client-side navigation, never in the URL.
 * @param scan - The scanned code.
 */
function openInGenerator(scan: ScanDescription) {
  stageGeneratorContent({ type: scan.type, value: scan.text });
  // nosemgrep: require-isdangerousurl -- an internal route from a fixed table, not scanned text
  void navigate(QR_TYPE_ROUTES[scan.type]);
}

/**
 * Standalone QR code scanner (/qr-code-scanner, #1034): camera scanning that starts only on
 * request, image scanning by file, paste or drop, the safe result sheet, and the how-to, privacy
 * and FAQ content.
 * @returns The page.
 */
export default function Page() {
  const page = usePageContent();

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-bold text-fg sm:text-4xl">{page?.tool?.heading}</h1>
        <p className="mb-6 text-fg-soft">
          Scan a QR code with your camera, or from a photo or screenshot. No app and no sign-up, and nothing leaves your
          browser.
        </p>

        <QRScanner autoStartCamera={false} onEdit={openInGenerator} editLabel="Open in generator" />

        <ul className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Privacy">
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
              <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="font-semibold text-fg">{title}</p>
                <p className="text-sm text-fg-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>

        <PageCopyContext.Provider value={copy}>
          <SidebarContent toolId="qr-code-scanner" />
        </PageCopyContext.Provider>

        <nav aria-labelledby="related-title" className="mt-10">
          <h2 id="related-title" className="mb-3 text-2xl font-bold text-fg">
            Related tools
          </h2>
          <ul className="space-y-2">
            <li>
              <a href="/" className={RELATED_LINK_CLASSES}>
                Make your own QR code
              </a>
            </li>
            <li>
              <a href="/file-transfer/receive" className={RELATED_LINK_CLASSES}>
                Receive a file over QR codes
              </a>
            </li>
            <li>
              <a href="/security" className={RELATED_LINK_CLASSES}>
                How QRCraftly protects your data
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}
