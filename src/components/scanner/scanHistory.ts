import type { ScanDescription } from './describeScan';

/** Results kept for this tab (#1101). */
const HISTORY_LIMIT = 5;

/**
 * Recent results, newest first, in module memory for this tab only: never stored, so a reload
 * clears them. They survive closing and reopening the scanner.
 */
let sessionHistory: ScanDescription[] = [];

/** Forgets this tab's scan history (tests). */
export function clearScanHistory(): void {
  sessionHistory = [];
}

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Escapes a single string field for RFC 4180 CSV text.
 * Neutralises leading formula characters (=, +, -, @, \t, \r) with a single quote to prevent
 * formula injection in spreadsheets, then wraps fields in double quotes if they contain
 * quotes, commas, or line breaks. Internal quotes are doubled.
 * @param field - Raw string value to escape.
 * @returns Escaped CSV field.
 */
export function escapeCsvField(field: string): string {
  const safe = FORMULA_START.test(field) ? `'${field}` : field;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * Formats active scan history records into RFC 4180 standard CSV text.
 * @param history - List of ScanDescription items.
 * @returns CSV string.
 */
export function formatScanHistoryCsv(history: ScanDescription[]): string {
  const headers = ['type', 'typeLabel', 'text'];
  const rows = history.map((item) =>
    [
      escapeCsvField(item.type),
      escapeCsvField(item.typeLabel),
      escapeCsvField(item.text),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\r\n');
}

export function rememberScan(scan: ScanDescription): ScanDescription[] {
  sessionHistory = [scan, ...sessionHistory.filter((item) => item.text !== scan.text)].slice(0, HISTORY_LIMIT);
  return sessionHistory;
}

/** This tab's results so far, newest first. */
export const currentScanHistory = (): ScanDescription[] => sessionHistory;
