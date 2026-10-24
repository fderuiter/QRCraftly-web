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

import { describe, it, expect, vi } from 'vitest';
import {
  runBatch,
  batchRows,
  batchZipName,
  batchPngSize,
  skippedFromReport,
  categorizeCsvRows,
  parseCsv,
  type BatchRow,
  type RunBatchOptions,
} from '../index';
import { DEFAULT_CONFIG } from '@/packages/core/config';

const noPause = () => Promise.resolve();

function options(overrides: Partial<RunBatchOptions> = {}): RunBatchOptions {
  return {
    format: 'svg',
    render: (payload) => Promise.resolve(`<svg>${payload}</svg>`),
    describeFailure: (err) => (err instanceof Error ? err.message : 'failed'),
    isCancelled: () => false,
    pause: noPause,
    ...overrides,
  };
}

const rows = (...stems: string[]): BatchRow[] =>
  stems.map((fileStem, i) => ({ rowNumber: i + 1, payload: `https://example.com/${i}`, fileStem }));

describe('runBatch', () => {
  it('draws every row into an entry named after its stem', async () => {
    const result = await runBatch(rows('alpha', 'beta'), options());
    expect(result.cancelled).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.entries).toEqual([
      { name: 'alpha.svg', data: '<svg>https://example.com/0</svg>' },
      { name: 'beta.svg', data: '<svg>https://example.com/1</svg>' },
    ]);
  });

  it('gives repeated stems unique names, case-insensitively', async () => {
    const result = await runBatch(rows('Menu', 'menu', 'MENU'), options({ format: 'png' }));
    expect(result.entries.map((e) => e.name)).toEqual(['Menu.png', 'menu_2.png', 'MENU_3.png']);
  });

  it('skips a row that cannot be drawn and carries on', async () => {
    const render = vi.fn((payload: string) =>
      payload.endsWith('/1') ? Promise.reject(new Error('too long')) : Promise.resolve('<svg/>')
    );
    const result = await runBatch(rows('a', 'b', 'c'), options({ render }));
    expect(render).toHaveBeenCalledTimes(3);
    expect(result.entries.map((e) => e.name)).toEqual(['a.svg', 'c.svg']);
    expect(result.skipped).toEqual([{ rowNumber: 2, reason: 'too long' }]);
  });

  it('stops on an error that would fail every row, and says which', async () => {
    const fatal = new Error('logo cannot be embedded');
    const render = vi.fn(() => Promise.reject(fatal));
    const onProgress = vi.fn();
    const result = await runBatch(rows('a', 'b'), options({ render, onProgress, stopOn: (err) => err === fatal }));
    expect(render).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
    expect(result).toEqual({ entries: [], skipped: [], cancelled: false, stoppedBy: fatal });
  });

  it('names EPS and PDF entries with their own extension', async () => {
    expect((await runBatch(rows('a'), options({ format: 'eps' }))).entries[0].name).toBe('a.eps');
    expect((await runBatch(rows('a'), options({ format: 'pdf' }))).entries[0].name).toBe('a.pdf');
  });

  it('reports progress once per row with the skips so far', async () => {
    const onProgress = vi.fn();
    const render = (payload: string) => (payload.endsWith('/0') ? Promise.reject(new Error('x')) : Promise.resolve('<svg/>'));
    await runBatch(rows('a', 'b'), options({ render, onProgress }));
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, [{ rowNumber: 1, reason: 'x' }]);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, [{ rowNumber: 1, reason: 'x' }]);
  });

  it('stops after the current row when cancelled', async () => {
    let cancelled = false;
    const render = vi.fn(() => {
      cancelled = true;
      return Promise.resolve('<svg/>');
    });
    const onProgress = vi.fn();
    const result = await runBatch(rows('a', 'b', 'c'), options({ render, onProgress, isCancelled: () => cancelled }));
    expect(render).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(true);
  });

  it('stops when cancelled during the pause between rows', async () => {
    let cancelled = false;
    const pause = () => {
      cancelled = true;
      return Promise.resolve();
    };
    const result = await runBatch(rows('a', 'b'), options({ pause, isCancelled: () => cancelled }));
    expect(result.cancelled).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it('returns an empty, finished result for no rows', async () => {
    expect(await runBatch([], options())).toEqual({ entries: [], skipped: [], cancelled: false });
  });

  it('yields to a timer between rows by default', async () => {
    vi.useFakeTimers();
    try {
      const done = runBatch(rows('a'), { ...options(), pause: undefined });
      await vi.runAllTimersAsync();
      expect((await done).entries).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('batchRows and skippedFromReport', () => {
  const table = parseCsv('url,name\nhttps://a.example,First\n\njavascript:alert(1),Bad\nhttps://b.example,\n');
  const report = categorizeCsvRows(table.rows, 'url', DEFAULT_CONFIG, undefined, { rowNumbers: table.rowNumbers });

  it('keeps spreadsheet row numbers and falls back to qr_<row> for a blank name', () => {
    const batch = batchRows(report, 'name', table.rowNumbers);
    expect(batch.map((r) => [r.rowNumber, r.fileStem])).toEqual([
      [1, 'First'],
      [table.rowNumbers[report.validRowIndices[1]], `qr_${table.rowNumbers[report.validRowIndices[1]]}`],
    ]);
    expect(batch.map((r) => r.payload)).toEqual(report.validPayloads);
  });

  it('numbers rows by position when no row numbers are given', () => {
    expect(batchRows(report, 'missing-column').map((r) => r.fileStem)).toEqual(
      report.validRowIndices.map((index) => `qr_${index + 1}`)
    );
  });

  it('lists only the unsafe rows as skipped, with their reasons', () => {
    const skipped = skippedFromReport(report);
    expect(skipped).toHaveLength(report.unsafeCount);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});

describe('batchZipName', () => {
  it('names the ZIP after the CSV without its extension', () => {
    expect(batchZipName('menu items.csv')).toBe('menu items-qrcodes.zip');
  });

  it('uses a generic name when there is no CSV name', () => {
    expect(batchZipName()).toBe('qr-codes-batch.zip');
    expect(batchZipName('')).toBe('qr-codes-batch.zip');
  });

  it('falls back when the name has nothing usable', () => {
    expect(batchZipName('.csv')).toBe('qr-codes-qrcodes.zip');
  });
});

describe('batchPngSize', () => {
  it('keeps a square design square', () => {
    expect(batchPngSize(1000, { width: 1, height: 1 })).toEqual({ width: 1000, height: 1000 });
  });

  it('rounds the height to follow a non-square format', () => {
    expect(batchPngSize(1000, { width: 1080, height: 1920 })).toEqual({ width: 1000, height: 1778 });
  });
});
