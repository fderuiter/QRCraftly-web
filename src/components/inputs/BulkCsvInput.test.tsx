/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BulkCsvInput } from './BulkCsvInput';
import { LazyBulkCsvInput } from './LazyBulkCsvInput';
import { BulkCsvData } from '@/types';
import { QRProvider } from '@/context/QRContext';
import * as downloadManager from '@/utils/downloadManager';
import * as qrExport from '@/packages/qr-export';
import { MAX_BULK_CSV_ROWS, SAMPLE_CSV_TEMPLATE } from '@/packages/bulk-csv';

/** Lists the entry names in the central directory of a stored ZIP archive. */
function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(pos + 28, true);
    names.push(new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen)));
    pos += 46 + nameLen + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
  return names;
}

function downloadedZip(): Uint8Array {
  const call = vi.mocked(downloadManager.triggerFileDownload).mock.calls[0];
  expect(call).toBeDefined();
  return call[0];
}

// Spy on file download trigger
vi.spyOn(downloadManager, 'triggerFileDownload').mockImplementation(() => {});

// Mock HTMLCanvasElement methods for jsdom
HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
  callback(new Blob(['mock-png-data'], { type: 'image/png' }));
});
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

function renderWithProvider(ui: React.ReactElement) {
  return render(<QRProvider>{ui}</QRProvider>);
}

describe('BulkCsvInput Component', () => {
  const initialData: BulkCsvData = {
    csvContent: '',
    payloadColumn: '',
    filenameColumn: '',
    exportFormat: 'png',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload prompt and sample template button when no CSV content is loaded', () => {
    renderWithProvider(<BulkCsvInput data={initialData} onChange={vi.fn()} />);

    expect(screen.getByText('Upload CSV or TXT File')).toBeInTheDocument();
    expect(screen.getByText('Choose File')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Sample Template' })).toBeInTheDocument();
  });

  it('triggers download of sample CSV template when Download Sample Template button is clicked', () => {
    renderWithProvider(<BulkCsvInput data={initialData} onChange={vi.fn()} />);

    const downloadBtn = screen.getByRole('button', { name: 'Download Sample Template' });
    fireEvent.click(downloadBtn);

    expect(downloadManager.triggerFileDownload).toHaveBeenCalledWith(
      expect.anything(),
      'qrcraftly-sample-template.csv',
      'text/csv'
    );

    const callArgs = vi.mocked(downloadManager.triggerFileDownload).mock.calls[0];
    const downloadedText = new TextDecoder().decode(callArgs[0]);
    expect(downloadedText).toBe(SAMPLE_CSV_TEMPLATE);
  });

  it('parses uploaded CSV file, detects columns, and displays controls', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';
    const onChange = vi.fn();

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      fileName: 'test-batch.csv',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={onChange} />);

    expect(screen.getByText('test-batch.csv')).toBeInTheDocument();
    expect(screen.getByText('2 rows found • 2 columns detected')).toBeInTheDocument();

    const payloadSelect = screen.getByLabelText('Payload Column (QR Content)') as HTMLSelectElement;
    expect(payloadSelect.value).toBe('URL');

    const filenameSelect = screen.getByLabelText('Filename Column') as HTMLSelectElement;
    expect(filenameSelect.value).toBe('Name');

    const formatSelect = screen.getByLabelText('Image Format') as HTMLSelectElement;
    expect(formatSelect.value).toBe('png');
  });

  it('lists unusual addresses without leaving them out (#1159)', () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,A\nhttps://paypa1.com/login,B\nhttps://192.168.0.1/,C';
    renderWithProvider(<BulkCsvInput data={{ ...initialData, csvContent, fileName: 'x.csv' }} onChange={vi.fn()} />);
    const list = screen.getByTestId('bulk-unusual-rows');
    expect(list).toHaveTextContent(/Row 2: .*imitates paypal/);
    expect(list).toHaveTextContent(/Row 3: .*number instead of a name/);
    expect(list).not.toHaveTextContent('Row 1');
    expect(screen.getByText(/2 addresses look unusual/)).toBeInTheDocument();
  });

  it('displays warning when CSV contains over 100 rows', () => {
    // Generate CSV with 105 rows
    const header = 'URL,Name\n';
    const rows = Array.from({ length: 105 }, (_, i) => `https://example.com/${i + 1},Name_${i + 1}`).join('\n');
    const csvContent = header + rows;

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      fileName: 'large-batch.csv',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    expect(screen.getByText(/Main Thread Processing Warning/)).toBeInTheDocument();
    expect(screen.getByText(/exceeding 100 rows/)).toBeInTheDocument();
  });

  it('shows error modal when CSV contains rows with empty payload values', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\n,Code2\nhttps://example.com/3,Code3';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'png',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('CSV Row Validation Errors')).toBeInTheDocument();
      expect(screen.getByText("Row 2: Empty value in payload column 'URL'")).toBeInTheDocument();
    });
  });

  it('generates ZIP batch and triggers file download for valid CSV rows in SVG format', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
      fileName: 'urls.csv',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(downloadManager.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'urls-qrcodes.zip',
        'application/zip'
      );
    });
    expect(zipEntryNames(downloadedZip())).toEqual(['Code1.svg', 'Code2.svg']);
  });

  it('generates ZIP batch and triggers file download for valid CSV rows in PNG format', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'png',
      fileName: 'urls.csv',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(downloadManager.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'urls-qrcodes.zip',
        'application/zip'
      );
    });
  });

  it('skips rows with dangerous payloads, lists them, and still zips the rest (#1152)', async () => {
    const csvContent = [
      'URL,Name',
      'https://example.com/ok,Good',
      'javascript:alert(1),Bad1',
      'data:text/html;base64,PHNjcmlwdD4=,Bad2',
      'intent://x#Intent;scheme=http;end,Bad3',
      'mailto:a@example.com,Mail',
    ].join('\n');
    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
      fileName: `../evil${String.fromCharCode(0x202e)}fdp.csv`,
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));

    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(zipEntryNames(downloadedZip())).toEqual(['Good.svg', 'Mail.svg']);
    // The ZIP name built from the uploaded file name is sanitised too.
    expect(vi.mocked(downloadManager.triggerFileDownload).mock.calls[0][1]).toBe('_evilfdp-qrcodes.zip');

    const list = await screen.findByTestId('bulk-skipped-rows');
    expect(list.textContent).toContain('Row 2');
    expect(list.textContent).toContain('Row 3');
    expect(list.textContent).toContain('Row 4');
    expect(list.textContent).not.toContain('Row 1:');
  });

  it('makes no ZIP when every row is blocked', async () => {
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\njavascript:alert(1),A',
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    expect(await screen.findByTestId('bulk-skipped-rows')).toBeInTheDocument();
    expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
  });

  it('skips rows without a payload and de-duplicates file names after confirmation', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Same\n,Empty\nhttps://example.com/3,same\nhttps://example.com/4,a/b';
    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip Bad Rows & Continue' }));

    await waitFor(() => {
      expect(downloadManager.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'qr-codes-batch.zip',
        'application/zip'
      );
    });
    expect(zipEntryNames(downloadedZip())).toEqual(['Same.svg', 'same_2.svg', 'a_b.svg']);
  });

  it(`warns and keeps only the first ${MAX_BULK_CSV_ROWS} rows of a larger file`, () => {
    const lines = Array.from({ length: MAX_BULK_CSV_ROWS + 20 }, (_, i) => `https://example.com/${i},N${i}`);
    const data: BulkCsvData = { ...initialData, csvContent: `URL,Name\n${lines.join('\n')}` };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    expect(screen.getByText(/Row limit reached/)).toBeInTheDocument();
    expect(screen.getByText(`${MAX_BULK_CSV_ROWS} rows found • 2 columns detected`)).toBeInTheDocument();
  });

  it('shows a parse error for malformed CSV and disables generation', () => {
    const data: BulkCsvData = { ...initialData, csvContent: 'URL,Name\n"https://example.com,unterminated' };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    expect(screen.getByText(/Could not read this CSV/)).toBeInTheDocument();
    expect(screen.getByText(/Unterminated quoted field/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Batch' })).toBeDisabled();
  });

  it('stores the detected column defaults', async () => {
    const onChange = vi.fn();
    const data: BulkCsvData = { ...initialData, csvContent: 'id,link\n1,https://example.com' };

    renderWithProvider(<BulkCsvInput data={data} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ payloadColumn: 'link', filenameColumn: 'id' });
    });
  });

  it('reads an uploaded file into memory', async () => {
    const onChange = vi.fn();
    renderWithProvider(<BulkCsvInput data={initialData} onChange={onChange} />);

    const file = new File(['URL,Name\nhttps://example.com,One'], 'batch.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Upload CSV or TXT file'), { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        csvContent: 'URL,Name\nhttps://example.com,One',
        fileName: 'batch.csv',
      });
    });
  });

  it('loads the batch generator lazily through the registry wrapper', async () => {
    renderWithProvider(<LazyBulkCsvInput data={initialData} onChange={vi.fn()} />);
    expect(await screen.findByText('Upload CSV or TXT File')).toBeInTheDocument();
  });

  it('renders resolution selector when PNG format is active and updates BulkCsvData on selection', () => {
    const onChange = vi.fn();
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/1,Code1',
      exportFormat: 'png',
      exportResolution: 1000,
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={onChange} />);

    const resSelect = screen.getByLabelText('PNG Resolution') as HTMLSelectElement;
    expect(resSelect).toBeInTheDocument();
    expect(resSelect.value).toBe('1000');

    fireEvent.change(resSelect, { target: { value: '2000' } });
    expect(onChange).toHaveBeenCalledWith({ exportResolution: 2000 });
  });

  it('hides resolution selector when SVG format is active', () => {
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/1,Code1',
      exportFormat: 'svg',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    expect(screen.queryByLabelText('PNG Resolution')).not.toBeInTheDocument();
  });

  it('passes configured resolution to rasterizeSvgToCanvas during PNG batch generation', async () => {
    const rasterizeSpy = vi.spyOn(qrExport, 'rasterizeSvgToCanvas');
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'png',
      exportResolution: 2000,
      fileName: 'urls.csv',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(rasterizeSpy).toHaveBeenCalledWith(expect.any(String), 2000, 2000);
    });

    rasterizeSpy.mockRestore();
  });
});
