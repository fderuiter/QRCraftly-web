import { Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { scanHeadline, type ScanDescription } from './describeScan';

interface ScanHistoryListProps {
  history: ScanDescription[];
  onOpen: (scan: ScanDescription) => void;
  onExport: () => void;
}

/** This tab's recent results (#1101), each reopening its result sheet, with a CSV export. */
export function ScanHistoryList({ history, onOpen, onExport }: ScanHistoryListProps) {
  if (history.length === 0) return null;
  return (
    <details className="border-t border-line-subtle px-4 py-3 text-sm">
      <summary className="flex cursor-pointer items-center justify-between font-medium text-fg-soft">
        <span>Recent scans in this tab ({history.length})</span>
      </summary>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">Kept in memory only. Reloading the page clears them.</p>
        <Button variant="secondary" size="sm" onClick={onExport} aria-label="Export scan history as CSV">
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>
      <ul className="mt-2 space-y-1">
        {history.map((item) => (
          <li key={item.text}>
            <Button variant="ghost" size="sm" className="max-w-full" onClick={() => onOpen(item)}>
              <span className="truncate">{scanHeadline(item)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
