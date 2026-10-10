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

import React, { Suspense, useState, useEffect } from 'react';
import type { QRConfig } from '../types';
import { TypeSelector, useInputLogic } from './inputs';
import { useDynamicFocus } from '../hooks/useDynamicFocus';
import { Button } from './ui/Button';
import { Camera } from 'lucide-react';
import { Modal } from './ui/Modal';
import { PanelErrorBoundary } from './ErrorBoundary';
import { Skeleton } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { getQRTypeLabel } from '@/data/qrTypeLabels';
import type { ScanDescription } from './scanner/describeScan';

/**
 * The scanner (camera engine, result sheet) loads when it is first wanted, not with the page.
 * Pointing at or focusing the button starts the download so the dialog opens ready.
 */
let scannerLoad: Promise<typeof import('./QRScanner')> | null = null;
const loadScanner = () => {
  scannerLoad ??= import('./QRScanner').catch((error: unknown) => {
    // A failed download (offline blip) can be tried again the next time the button is used.
    scannerLoad = null;
    throw error;
  });
  return scannerLoad;
};
const QRScanner = React.lazy(() => loadScanner().then((module) => ({ default: module.QRScanner })));
const prefetchScanner = () => void loadScanner().catch(() => undefined);

/** Stand-in while the scanner's code loads. */
const ScannerLoading = () => (
  <div className="p-4" role="status">
    <Skeleton className="aspect-square w-full sm:aspect-video" />
    <span className="sr-only">Loading the scanner...</span>
  </div>
);

/**
 * Props for the InputPanel component.
 */
interface InputPanelProps {
  /** The content slice of the QR configuration (the panel reads only type and value). */
  config: Pick<QRConfig, 'type' | 'value'>;
  /** Callback to update the configuration. */
  onChange: (updates: Partial<QRConfig>) => void;
  /** Told whether the form holds a value it refuses to encode (#1279). */
  onRefusedChange?: (refused: boolean) => void;
}

/**
 * A component that provides input fields for different QR code types.
 * Allows users to enter data for URL, Text, WiFi, Email, vCard, Phone, and SMS.
 * It updates the main configuration with the formatted string for the QR code.
 * @param props - The component props.
 * @param props.config - The current QR code configuration state.
 * @param props.onChange - Callback function to update the configuration.
 * @param props.onRefusedChange - Told whether the form holds a value it refuses to encode.
 * @returns The InputPanel component.
 */
const InputPanel: React.FC<InputPanelProps> = ({ config, onChange, onRefusedChange }) => {
  const { InputComponent, inputProps, flush } = useInputLogic(config, onChange, onRefusedChange);
  const containerRef = useDynamicFocus<HTMLDivElement>([config.type]);
  const [announcement, setAnnouncement] = useState('');
  const [scannerActive, setScannerActive] = useState(false);
  // Each opening is a fresh scanner, even when it reopens during the previous close animation.
  const [scanSession, setScanSession] = useState(0);
  const { addToast } = useToast();

  // Update live region announcement when type changes
  useEffect(() => {
    // Only announce when type is explicitly changed, don't re-announce on simple re-renders
    setAnnouncement(`${getQRTypeLabel(config.type)} input loaded`);
  }, [config.type]);

  // A scan opens in the generator only from the result sheet, and never silently: replaced
  // content can be restored from the toast (#1101).
  const handleEditScan = (scan: ScanDescription) => {
    setScannerActive(false);
    const previous = { type: config.type, value: config.value };
    const replacing = previous.value.trim() !== '' && previous.value !== scan.text;
    onChange({ type: scan.type, value: scan.text });
    addToast({
      type: 'success',
      message: `Loaded the scanned ${getQRTypeLabel(scan.type)} code into the generator.`,
      duration: replacing ? 10000 : 5000,
      action: replacing ? { label: 'Undo', onClick: () => onChange(previous) } : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Live Region for Screen Readers */}
      <div 
        aria-live="polite" 
        className="sr-only"
        role="status"
      >
        {announcement}
      </div>

      {/* Type Selector */}
      <TypeSelector currentType={config.type} />

      {/* Inputs or Scanner Container */}
      <div
        id="qr-content-input"
        className="space-y-4"
        ref={containerRef}
        // Commit a pending debounced edit as soon as focus leaves the inputs, so a button
        // pressed right after typing acts on what was typed.
        onBlur={flush}
      >
        {InputComponent && <InputComponent {...inputProps} />}
      </div>

      {/* Scanner: a dialog that returns focus to this button when it closes (#1102). */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setScanSession((session) => session + 1);
            setScannerActive(true);
          }}
          onPointerEnter={prefetchScanner}
          onFocus={prefetchScanner}
          className="flex items-center gap-2"
          aria-haspopup="dialog"
        >
          <Camera className="size-4" aria-hidden="true" />
          Scan QR Code
        </Button>
      </div>
      <Modal isOpen={scannerActive} onClose={() => setScannerActive(false)} title="Scan a QR code" size="lg" closeLabel="Close scanner">
        {/* A scanner chunk that fails to load (a stale deploy, a dropped connection) shows the panel message here, not in place of the whole generator. */}
        <div className="p-4 sm:p-0">
          <PanelErrorBoundary key={scanSession}>
            <Suspense fallback={<ScannerLoading />}>
              <QRScanner key={scanSession} onEdit={handleEditScan} />
            </Suspense>
          </PanelErrorBoundary>
        </div>
      </Modal>
    </div>
  );
};

/**
 * Comparison function for React.memo.
 * Returns true if the next props are equivalent to the previous props (skipping re-render).
 * It ignores changes to 'fgColor', 'bgColor', 'style', etc. as they don't affect the input panel.
 * @param prev - Previous props of the input panel.
 * @param next - Next props of the input panel.
 * @returns True if previous and next props are equivalent.
 */
function areInputPropsEqual(prev: InputPanelProps, next: InputPanelProps) {
  // If the onChange handler changed, we must re-render
  if (prev.onChange !== next.onChange) return false;

  // We only care about config.type and config.value for the input panel.
  // Style changes (colors, etc.) should NOT trigger a re-render of inputs.
  return prev.config.type === next.config.type &&
         prev.config.value === next.config.value;
}

export default React.memo(InputPanel, areInputPropsEqual);
