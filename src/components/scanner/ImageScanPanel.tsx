import React, { useId, useRef } from 'react';
import { Copy, FileImage, RefreshCw, Upload } from 'lucide-react';
import { Button } from '../ui/Button';

interface ImageScanPanelProps {
  /** Highlights the panel while an image is dragged over the scanner. */
  dragging: boolean;
  fileError: string | null;
  fileProcessing: boolean;
  /** Whether "Paste image" can read the clipboard here. */
  canPaste: boolean;
  onFile: (file: File) => void;
  onPaste: () => void;
}

/**
 * Image mode of the scanner (#1603): choose, paste or drop a photo or screenshot, with the
 * progress line and the error the last image produced.
 */
export function ImageScanPanel({ dragging, fileError, fileProcessing, canPaste, onFile, onPaste }: ImageScanPanelProps) {
  const ids = useId();
  const fileErrorId = `${ids}-file-error`;
  const imageTitleId = `${ids}-image-title`;
  const imageHelpId = `${ids}-image-help`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFile(file);
      e.target.value = '';
    }
  };

  return (
    <section
      aria-labelledby={imageTitleId}
      aria-describedby={imageHelpId}
      className={`flex size-full flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center ${
        dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface-sunken'
      }`}
    >
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} aria-label="Upload QR code image file" />
      <FileImage className="size-10 text-fg-muted" aria-hidden="true" />
      <h3 id={imageTitleId} className="text-base font-semibold text-fg">
        Scan from an image
      </h3>
      <p id={imageHelpId} className="max-w-sm text-sm text-fg-muted">
        Choose a photo or screenshot, paste one with Ctrl+V or ⌘V, or drop it anywhere on the scanner. It never leaves this device.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => fileInputRef.current?.click()} aria-describedby={fileError ? fileErrorId : undefined}>
          <Upload className="size-4" aria-hidden="true" />
          Choose image
        </Button>
        {canPaste && (
          <Button variant="secondary" onClick={onPaste}>
            <Copy className="size-4" aria-hidden="true" />
            Paste image
          </Button>
        )}
      </div>
      {fileProcessing && (
        <p className="flex items-center gap-2 text-sm font-medium text-fg-soft">
          <RefreshCw className="size-4 text-accent motion-safe:animate-spin" aria-hidden="true" />
          Processing file...
        </p>
      )}
      {fileError && (
        <p id={fileErrorId} role="alert" className="max-w-sm rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {fileError}
        </p>
      )}
    </section>
  );
}
