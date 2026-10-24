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

import { Activity, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { createPrismSession, TRANSFER_DENSITY_PROFILES } from '@/packages/optical-transfer';

/**
 * Feeds the receiver a rateless Prism stream joined mid-stream with about 30% of frames dropped.
 * @param clear - Resets the receiver first.
 * @param handleFrame - Takes each frame's text, as the camera would.
 */
async function simulatePrismStream(clear: () => void, handleFrame: (text: string) => void) {
  clear();
  const text = 'Prism-coded air-gapped transfer: join at any frame, lose any frame. '.repeat(8);
  const { stream } = await createPrismSession(new TextEncoder().encode(text), {
    fileName: 'prism_demo.txt',
    mimeType: 'text/plain',
    errorCorrectionLevel: TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
    maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
  });
  let delay = 0;
  for (let index = 7; index < stream.k * 4 + 32; index++) {
    if (index % 10 < 3) continue;
    const frame = stream.frameText(index);
    setTimeout(() => handleFrame(frame), delay);
    delay += 20;
  }
}

/**
 * Development only: a button that plays a simulated stream into the receiver. Renders nothing in
 * a production build.
 * @returns The simulation section, or null.
 */
export function ReceiveSimulator({ onClear, onFrame }: { onClear: () => void; onFrame: (text: string) => void }) {
  if (!import.meta.env.DEV) return null;
  return (
    <>
      <div className="h-px bg-surface-hover" />

      {/* Quick Testing Simulation Controls */}
      <section className="space-y-4">
        <SectionHeading icon={<Cpu className="size-4 text-accent" aria-hidden="true" />} eyebrow="3. Simulation & Validation Testing" />

        <div className="grid grid-cols-1 gap-2">
          <Button
            variant="outline"
            onClick={() => void simulatePrismStream(onClear, onFrame)}
            className="justify-start text-left"
          >
            <Activity className="size-4 text-accent" aria-hidden="true" />
            Simulate Prism Stream (mid-stream, 30% loss)
          </Button>
        </div>
      </section>
    </>
  );
}
