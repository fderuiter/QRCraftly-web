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
import { CloudUpload, Gamepad2, ShieldCheck } from 'lucide-react';
import { QRChecker } from '@/components/QRChecker';
import type { ScanDescription } from '@/components/scanner/describeScan';
import { SidebarContent } from '@/components/SidebarContent';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { usePageContent } from '@/data/PageContentContext';
import type { ToolCopy } from '@/data/copy/types';
import { QR_TYPE_ROUTES } from '@/data/navigation';
import { stageGeneratorContent } from '@/context/QRContext';

/** The plain promises under the checker, each backed by how it works. */
const PROMISES = [
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'The picture is read on this device and never sent anywhere.' },
  { icon: ShieldCheck, title: 'Links checked first', text: 'See the real address before opening a link. Script links are blocked.' },
  { icon: Gamepad2, title: 'Test durability too', text: 'The Arcade damages a code the way smudges, folds and glare do.' },
] as const;

const LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/**
 * Opens a checked code in the generator for its type. The content is handed over in memory for
 * the client-side navigation, never in the URL.
 * @param scan - The checked code.
 */
function openInGenerator(scan: ScanDescription) {
  stageGeneratorContent({ type: scan.type, value: scan.text });
  // nosemgrep: require-isdangerousurl -- an internal route from a fixed table, not scanned text
  void navigate(QR_TYPE_ROUTES[scan.type]);
}

/** Copy used before the page's content is available. */
const NO_COPY: ToolCopy = {};

/**
 * Standalone QR code checker (/qr-code-checker, #1036): upload, drop or paste a picture of any
 * QR code and get a scannability report plus what it holds.
 * @returns The page.
 */
export default function Page() {
  const page = usePageContent();
  const copy = page?.landing ?? NO_COPY;

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-3xl font-bold text-fg sm:text-4xl">{page?.tool?.heading}</h1>
        <p className="mb-6 text-fg-soft">
          Find out what a QR code holds and whether it will scan, even after print blur. No sign-up, and nothing leaves your browser.
        </p>

        <QRChecker onEdit={openInGenerator} />

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
          <SidebarContent toolId="qr-code-checker" />
        </PageCopyContext.Provider>

        <nav aria-labelledby="related-title" className="mt-10">
          <h2 id="related-title" className="mb-3 text-2xl font-bold text-fg">
            Related tools
          </h2>
          <ul className="space-y-2">
            <li>
              <a href="/arcade" className={LINK_CLASSES}>
                Stress-test a code in the Arcade
              </a>
            </li>
            <li>
              <a href="/qr-code-scanner" className={LINK_CLASSES}>
                Scan a code with your camera
              </a>
            </li>
            <li>
              <a href="/" className={LINK_CLASSES}>
                Make your own QR code
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}
