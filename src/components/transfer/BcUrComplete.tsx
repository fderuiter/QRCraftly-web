import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { analyseReceivedFile } from '@/utils/fileNames';
import { formatFileSize } from '@/utils/transferSpeed';

/** What a finished wallet-style (BC-UR) stream holds. */
export type BcUrContent =
  | { kind: 'file'; bytes: Uint8Array }
  | { kind: 'text'; text: string }
  | { kind: 'cbor'; bytes: Uint8Array };

interface BcUrCompleteProps {
  /** The UR type, such as `bytes`. */
  type: string;
  content: BcUrContent;
  onSave: (data: Uint8Array, fileName: string, mimeType: string) => void;
  onReceiveAnother: () => void;
}

/** The only characters kept from a UR type that names a saved file. */
const safeType = (type: string): string => type.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'data';

/**
 * The finish of a wallet-style (BC-UR, #1149) receive. The sender is another device or app, so
 * nothing here is checked against a QRCraftly manifest: only BC-UR's own CRC-32 held. The text
 * kind is shown as plain text and never as a link.
 * @param props - Component properties.
 * @param props.type - The UR type.
 * @param props.content - What the stream held.
 * @param props.onSave - Saves bytes under a name.
 * @param props.onReceiveAnother - Clears and starts over.
 * @returns The completion panel.
 */
export function BcUrComplete({ type, content, onSave, onReceiveAnother }: BcUrCompleteProps) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const bytes = content.kind === 'text' ? new TextEncoder().encode(content.text) : content.bytes;
  const fileName = content.kind === 'cbor' ? `${safeType(type)}.cbor` : 'received-ur-bytes.bin';
  const analysis = analyseReceivedFile(fileName, 'application/octet-stream');

  const save = () => {
    if (analysis.risky && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onSave(bytes, analysis.safeName, analysis.mimeType);
  };

  const copy = async () => {
    if (content.kind !== 'text') return;
    try {
      await navigator.clipboard.writeText(content.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex size-full flex-col items-center gap-4 bg-surface-sunken p-6 text-center" data-testid="bcur-complete-panel">
      <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success motion-safe:animate-pop-in">
        <Check className="size-9" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-lg font-bold text-fg">Wallet-style stream received</h3>
        <p className="mt-1 text-xs text-fg-muted" data-testid="bcur-summary">
          Type <span className="font-mono">{safeType(type)}</span>, {formatFileSize(bytes.length)}. The stream&apos;s own CRC-32 matched. It comes from another app or device, so
          QRCraftly cannot vouch for what it contains.
        </p>
      </div>
      <Badge tone="neutral">BC-UR (BCR-2024-001)</Badge>
      {content.kind === 'text' && (
        <pre
          className="max-h-48 w-full max-w-sm overflow-auto rounded-lg border border-line bg-surface p-2 text-left font-mono text-xs break-all whitespace-pre-wrap text-fg"
          data-testid="bcur-text"
        >
          {content.text}
        </pre>
      )}
      {confirming && (
        <p role="alert" className="text-xs text-fg-muted">
          This kind of file can run programs on your device. Only save it if you trust the sender.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {content.kind === 'text' && (
          <Button variant="outline" onClick={() => void copy()}>
            <Copy className="size-4" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy text'}
          </Button>
        )}
        <Button variant="primary" onClick={save}>
          {confirming ? 'Save anyway' : content.kind === 'text' ? 'Save as .bin' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onReceiveAnother}>
          Receive another
        </Button>
      </div>
    </div>
  );
}
