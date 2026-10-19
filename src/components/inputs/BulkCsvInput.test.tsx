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
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BulkCsvInput } from './BulkCsvInput';
import { LazyBulkCsvInput } from './LazyBulkCsvInput';
import { type BulkCsvData, SocialFormat } from '@/types';
import { QRProvider, useQRStore, type QRStore } from '@/context/QRContext';
import { ToastProvider } from '../ui/Toast';
import * as downloadManager from '@/utils/downloadManager';
import * as qrExport from '@/packages/qr-export';
import * as bulkCsv from '@/packages/bulk-csv';
import { MAX_BULK_CSV_ROWS, SAMPLE_CSV_TEMPLATE } from '@/packages/bulk-csv';

// The real row check, wrapped so a test can count how often it runs.
vi.mock('@/packages/bulk-csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/bulk-csv')>();
  return { ...actual, categorizeCsvRows: vi.fn(actual.categorizeCsvRows) };
});

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

/** Lists entry names and text contents in the central directory of a stored ZIP archive. */
function zipEntries(bytes: Uint8Array): { name: string; content: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const entries: { name: string; content: string }[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    const localOffset = view.getUint32(pos + 42, true);

    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataSize = view.getUint32(localOffset + 18, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const content = new TextDecoder().decode(bytes.subarray(dataStart, dataStart + dataSize));
    entries.push({ name, content });

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
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

function renderWithToasts(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <QRProvider>{ui}</QRProvider>
    </ToastProvider>
  );
}

/** The payload each generated code was asked to encode, in call order. */
function encodedValues(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => (call[0] as { value: string }).value);
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

    const payloadSelect = screen.getByLabelText('Content Column');
    expect(payloadSelect).toHaveValue('URL');

    const filenameSelect = screen.getByLabelText('File Name Column');
    expect(filenameSelect).toHaveValue('Name');

    const formatSelect = screen.getByLabelText('Image Format');
    expect(formatSelect).toHaveValue('png');
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

  it('renders preflight summary card and updates button label when CSV contains rows with empty payload values', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\n,Code2\nhttps://example.com/3,Code3';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'png',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);

    expect(screen.getByTestId('preflight-summary-card')).toBeInTheDocument();
    expect(screen.getByTestId('count-total')).toHaveTextContent('3');
    expect(screen.getByTestId('count-valid')).toHaveTextContent('2');
    expect(screen.getByTestId('count-empty')).toHaveTextContent('1');

    // Toggle row details
    const toggleBtn = screen.getByTestId('preflight-expand-toggle');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('preflight-details-list')).toBeInTheDocument();
    expect(screen.getByText("Missing value in payload column 'URL'")).toBeInTheDocument();

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch for 2 Valid Rows' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(downloadManager.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'qr-codes-batch.zip',
        'application/zip'
      );
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

  it('generates ZIP batch and triggers file download for valid CSV rows in EPS format', async () => {
    const convertEpsSpy = vi.spyOn(qrExport, 'convertSvgToEps');
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'eps',
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
    expect(convertEpsSpy).toHaveBeenCalledTimes(2);
    const epsEntries = zipEntries(downloadedZip());
    expect(epsEntries.map((e) => e.name)).toEqual(['Code1.eps', 'Code2.eps']);
    expect(epsEntries[0].content).toMatch(/^%!PS-Adobe-3\.0 EPSF-3\.0/);
    expect(epsEntries[1].content).toMatch(/^%!PS-Adobe-3\.0 EPSF-3\.0/);
    convertEpsSpy.mockRestore();
  });

  it('generates ZIP batch and triggers file download for valid CSV rows in PDF format', async () => {
    const convertPdfSpy = vi.spyOn(qrExport, 'convertSvgToPdf');
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'pdf',
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
    expect(convertPdfSpy).toHaveBeenCalledTimes(2);
    const pdfEntries = zipEntries(downloadedZip());
    expect(pdfEntries.map((e) => e.name)).toEqual(['Code1.pdf', 'Code2.pdf']);
    expect(pdfEntries[0].content).toMatch(/^%PDF-/);
    expect(pdfEntries[1].content).toMatch(/^%PDF-/);
    convertPdfSpy.mockRestore();
  });

  it('stops batch, creates no ZIP, and shows error toast when MissingImageError is thrown during vector conversion', async () => {
    const convertEpsSpy = vi.spyOn(qrExport, 'convertSvgToEps').mockRejectedValue(new qrExport.MissingImageError());
    const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';

    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'eps',
    };

    renderWithToasts(<BulkCsvInput data={data} onChange={vi.fn()} />);

    const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/The logo couldn't be embedded in EPS\/PDF files/i);
    });

    expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
    convertEpsSpy.mockRestore();
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
    fireEvent.click(screen.getByRole('button', { name: /Generate Batch/ }));

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

  it('makes no ZIP and disables button when every row is blocked', async () => {
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\njavascript:alert(1),A',
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'No Valid Rows to Generate' });
    expect(btn).toBeDisabled();
    expect(screen.getByTestId('count-unsafe')).toHaveTextContent('1');
    expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
  });

  it('skips rows without a payload and de-duplicates file names directly', async () => {
    const csvContent = 'URL,Name\nhttps://example.com/1,Same\n,Empty\nhttps://example.com/3,same\nhttps://example.com/4,a/b';
    const data: BulkCsvData = {
      ...initialData,
      csvContent,
      payloadColumn: 'URL',
      filenameColumn: 'Name',
      exportFormat: 'svg',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch for 3 Valid Rows' }));

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
    expect(screen.getByRole('button', { name: 'No Valid Rows to Generate' })).toBeDisabled();
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

    const resSelect = screen.getByLabelText('PNG Width');
    expect(resSelect).toBeInTheDocument();
    expect(resSelect).toHaveValue('1000');

    fireEvent.change(resSelect, { target: { value: '2000' } });
    expect(onChange).toHaveBeenCalledWith({ exportResolution: 2000 });
  });

  it('hides resolution selector when vector formats (SVG, EPS, PDF) are active', () => {
    const dataSvg: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/1,Code1',
      exportFormat: 'svg',
    };
    const { rerender } = renderWithProvider(<BulkCsvInput data={dataSvg} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('PNG Width')).not.toBeInTheDocument();

    const dataEps: BulkCsvData = { ...dataSvg, exportFormat: 'eps' };
    rerender(
      <QRProvider>
        <BulkCsvInput data={dataEps} onChange={vi.fn()} />
      </QRProvider>
    );
    expect(screen.queryByLabelText('PNG Width')).not.toBeInTheDocument();

    const dataPdf: BulkCsvData = { ...dataSvg, exportFormat: 'pdf' };
    rerender(
      <QRProvider>
        <BulkCsvInput data={dataPdf} onChange={vi.fn()} />
      </QRProvider>
    );
    expect(screen.queryByLabelText('PNG Width')).not.toBeInTheDocument();
  });

  it('updates export format when EPS or PDF is selected in the format dropdown', () => {
    const onChange = vi.fn();
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/1,Code1',
      exportFormat: 'png',
    };

    renderWithProvider(<BulkCsvInput data={data} onChange={onChange} />);

    const formatSelect = screen.getByLabelText('Image Format');
    expect(formatSelect).toBeInTheDocument();

    fireEvent.change(formatSelect, { target: { value: 'eps' } });
    expect(onChange).toHaveBeenCalledWith({ exportFormat: 'eps' });

    fireEvent.change(formatSelect, { target: { value: 'pdf' } });
    expect(onChange).toHaveBeenCalledWith({ exportFormat: 'pdf' });
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

  it('keeps the design shape for Story and Portrait PNGs (#1289)', async () => {
    const rasterizeSpy = vi.spyOn(qrExport, 'rasterizeSvgToCanvas');
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/1,Code1',
      exportResolution: 1080,
    };
    render(
      <QRProvider initialConfig={{ socialFormat: SocialFormat.STORY_9_16 }}>
        <BulkCsvInput data={data} onChange={vi.fn()} />
      </QRProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(rasterizeSpy).toHaveBeenCalledWith(expect.any(String), 1080, 1920));
    rasterizeSpy.mockRestore();
  });

  it('encodes links exactly as the single Link generator does, spaces included (#1285)', async () => {
    const svgSpy = vi.spyOn(qrExport, 'generateQRSvg');
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\nhttps://example.com/ok,A\nhttps://example.com/my file.pdf,B\nexample.com,C',
      exportFormat: 'svg',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(zipEntryNames(downloadedZip())).toEqual(['A.svg', 'B.svg', 'C.svg']);
    expect(encodedValues(svgSpy)).toEqual([
      'https://example.com/ok',
      'https://example.com/my%20file.pdf',
      'https://example.com/',
    ]);
    svgSpy.mockRestore();
  });

  it('encodes plain text as typed in Text mode (#1285)', async () => {
    const svgSpy = vi.spyOn(qrExport, 'generateQRSvg');
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'qr,Name\n"BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD",Jane\nOrder no. 5,Order\njohn.doe@example.com,John',
      exportFormat: 'svg',
      contentType: 'text',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Content Type')).toHaveValue('text');
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(encodedValues(svgSpy)).toEqual(['BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD', 'Order no. 5', 'john.doe@example.com']);
    svgSpy.mockRestore();
  });

  it('switches the content type', () => {
    const onChange = vi.fn();
    renderWithProvider(<BulkCsvInput data={{ ...initialData, csvContent: 'URL\nhttps://example.com' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Content Type'), { target: { value: 'text' } });
    expect(onChange).toHaveBeenCalledWith({ contentType: 'text' });
  });

  it('says beside the preview when the previewed row is left out (#1285)', () => {
    const data: BulkCsvData = { ...initialData, csvContent: 'URL,Name\njavascript:alert(1),A\nhttps://example.com,B' };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    expect(screen.getByTestId('bulk-preview-row')).toHaveTextContent(/Preview: row 1\..*This row is left out of the ZIP: /);
  });

  it('skips a row too long for a QR code and zips the rest (#1286)', async () => {
    const long = `https://example.com/${'a'.repeat(3000)}`;
    const data: BulkCsvData = {
      ...initialData,
      csvContent: `URL,Name\nhttps://example.com/1,One\n${long},Two\nhttps://example.com/3,Three`,
      exportFormat: 'svg',
    };
    renderWithToasts(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(zipEntryNames(downloadedZip())).toEqual(['One.svg', 'Three.svg']);
    const list = await screen.findByTestId('bulk-skipped-rows');
    expect(list).toHaveTextContent(/Row 2: Too long for a QR code at error correction level/);
    expect(await screen.findByText(/Downloaded a ZIP with 2 QR codes\. 1 row was left out\./)).toBeInTheDocument();
  });

  it('reads semicolon-separated files (#1287)', async () => {
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL;Name\nhttps://example.com/1;Code1\nhttps://example.com/2;Code2',
      exportFormat: 'svg',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    expect(screen.getByText(/2 rows found • 2 columns detected • semicolon-separated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(zipEntryNames(downloadedZip())).toEqual(['Code1.svg', 'Code2.svg']);
  });

  it('reads an uploaded UTF-16 tab-delimited file, as Excel saves "Unicode Text" (#1287)', async () => {
    const text = 'URL\tName\r\nhttps://example.com/1\tCode1\r\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    const onChange = vi.fn();
    renderWithProvider(<BulkCsvInput data={initialData} onChange={onChange} />);
    const file = new File([bytes], 'export.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Upload CSV or TXT file'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ csvContent: text, fileName: 'export.txt' }));
  });

  it('cancels a running batch: no ZIP, and a notice (#1290)', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `https://example.com/${i},N${i}`);
    const data: BulkCsvData = { ...initialData, csvContent: `URL,Name\n${lines.join('\n')}`, exportFormat: 'svg' };
    renderWithToasts(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Batch canceled. No ZIP was made.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
    expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
  });

  it('stops the batch when the page is left (#1290)', async () => {
    const svgSpy = vi.spyOn(qrExport, 'generateQRSvg');
    const lines = Array.from({ length: 30 }, (_, i) => `https://example.com/${i},N${i}`);
    const data: BulkCsvData = { ...initialData, csvContent: `URL,Name\n${lines.join('\n')}`, exportFormat: 'svg' };
    const { unmount } = renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
    await waitFor(() => expect(svgSpy).toHaveBeenCalled());
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
    expect(svgSpy.mock.calls.length).toBeLessThan(30);
    svgSpy.mockRestore();
  });

  it('clears the skipped-rows list when another file is loaded (#1291)', async () => {
    const one: BulkCsvData = { ...initialData, csvContent: 'URL,Name\nhttps://example.com/1,A\njavascript:alert(1),B', exportFormat: 'svg' };
    const { rerender } = renderWithProvider(<BulkCsvInput data={one} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Batch/ }));
    expect(await screen.findByTestId('bulk-skipped-rows')).toBeInTheDocument();
    const two: BulkCsvData = { ...one, csvContent: 'URL,Name\nhttps://example.com/2,C', fileName: 'two.csv' };
    rerender(
      <QRProvider>
        <BulkCsvInput data={two} onChange={vi.fn()} />
      </QRProvider>
    );
    await waitFor(() => expect(screen.queryByTestId('bulk-skipped-rows')).not.toBeInTheDocument());
  });

  it('reports spreadsheet row numbers and names fallback files after them (#1291)', async () => {
    const data: BulkCsvData = {
      ...initialData,
      csvContent: 'URL,Name\njavascript:alert(1),Bad\n\nhttps://example.com/3,',
      exportFormat: 'svg',
    };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Generate Batch/ }));
    await waitFor(() => expect(downloadManager.triggerFileDownload).toHaveBeenCalled());
    expect(zipEntryNames(downloadedZip())).toEqual(['qr_3.svg']);
    expect(await screen.findByTestId('bulk-skipped-rows')).toHaveTextContent('Row 1:');
  });

  it('renders a CSV whose header is __proto__ (#1291)', () => {
    const data: BulkCsvData = { ...initialData, csvContent: '__proto__\nhttps://example.com/1' };
    renderWithProvider(<BulkCsvInput data={data} onChange={vi.fn()} />);
    expect(screen.getByText('1 rows found • 1 columns detected')).toBeInTheDocument();
    expect(screen.getByTestId('count-valid')).toHaveTextContent('1');
  });

  it('does not pick a URL column as the file name column (#1291)', async () => {
    const onChange = vi.fn();
    renderWithProvider(<BulkCsvInput data={{ ...initialData, csvContent: 'Video URL,Title\nhttps://example.com,Intro' }} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ payloadColumn: 'Video URL', filenameColumn: 'Title' }));
  });

  it('previews the first rows under the chosen content and file name columns', () => {
    const csvContent = 'URL,Name,Note\nhttps://example.com/1,first,a\nhttps://example.com/2,second,b\nhttps://example.com/3,third,c\nhttps://example.com/4,fourth,d';
    const onChange = vi.fn();
    const base = { ...initialData, csvContent, fileName: 'batch.csv', payloadColumn: 'URL', filenameColumn: 'Name' };
    const { rerender } = renderWithProvider(<BulkCsvInput data={base} onChange={onChange} />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('caption')).toHaveTextContent('First 3 rows');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText('fourth')).not.toBeInTheDocument();

    // Changing the File Name Column in the select reports the mapping; the table follows the new data.
    fireEvent.change(screen.getByLabelText('File Name Column'), { target: { value: 'Note' } });
    expect(onChange).toHaveBeenCalledWith({ filenameColumn: 'Note' });
    rerender(
      <QRProvider>
        <BulkCsvInput data={{ ...base, filenameColumn: 'Note' }} onChange={onChange} />
      </QRProvider>
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Row', 'URLContent', 'NoteFile name']);
    expect(screen.getByText('c')).toBeInTheDocument();

    rerender(
      <QRProvider>
        <BulkCsvInput data={{ ...base, payloadColumn: 'Name', filenameColumn: 'URL' }} onChange={onChange} />
      </QRProvider>
    );
    expect(screen.getAllByRole('columnheader')[1]).toHaveTextContent('NameContent');
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  describe('Pre-flight Logo Asset Validation', () => {
    it('halts PNG batch generation and shows actionable error toast when custom logo URL fails preflight check', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      try {
        const spyPreflight = vi.spyOn(qrExport, 'preflightLogoCheck');
        const csvContent = 'URL,Name\nhttps://example.com/1,Code1\nhttps://example.com/2,Code2';
        const data: BulkCsvData = {
          ...initialData,
          csvContent,
          payloadColumn: 'URL',
          filenameColumn: 'Name',
          exportFormat: 'png',
        };

        const renderResult = renderWithToasts(
          <QRProvider
            initialConfig={{
              logoUrl: 'https://example.com/unreachable-logo.png',
            }}
          >
            <BulkCsvInput data={data} onChange={vi.fn()} />
          </QRProvider>
        );

        const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
        fireEvent.click(generateBtn);

        await waitFor(() => {
          expect(spyPreflight).toHaveBeenCalled();
        });

        await waitFor(() => {
          expect(screen.getByRole('alert')).toHaveTextContent(/Could not load custom logo asset/i);
        });

        expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
        spyPreflight.mockRestore();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('continues SVG batch export and warns user with toast when remote logo loading fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      try {
        const csvContent = 'URL,Name\nhttps://example.com/1,Code1';
        const data: BulkCsvData = {
          ...initialData,
          csvContent,
          payloadColumn: 'URL',
          filenameColumn: 'Name',
          exportFormat: 'svg',
        };

        renderWithToasts(
          <QRProvider
            initialConfig={{
              logoUrl: 'https://example.com/unreachable-logo.png',
            }}
          >
            <BulkCsvInput data={data} onChange={vi.fn()} />
          </QRProvider>
        );

        const generateBtn = screen.getByRole('button', { name: 'Generate Batch' });
        fireEvent.click(generateBtn);

        await waitFor(() => {
          expect(downloadManager.triggerFileDownload).toHaveBeenCalled();
        });

        await waitFor(() => {
          expect(screen.getByRole('alert')).toHaveTextContent(/The logo was left out of these codes/i);
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('closes the progress dialog when the batch is canceled during the logo check', async () => {
      let finishCheck: (result: { ok: boolean }) => void = () => {};
      const spyPreflight = vi
        .spyOn(qrExport, 'preflightLogoCheck')
        .mockImplementation(() => new Promise((resolve) => { finishCheck = resolve; }));
      const data: BulkCsvData = { ...initialData, csvContent: 'URL,Name\nhttps://example.com/1,Code1', exportFormat: 'png' };
      renderWithToasts(
        <QRProvider initialConfig={{ logoUrl: 'data:image/png;base64,AA==' }}>
          <BulkCsvInput data={data} onChange={vi.fn()} />
        </QRProvider>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Generate Batch' }));
      await waitFor(() => expect(spyPreflight).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      finishCheck({ ok: true });

      expect(await screen.findByText('Batch canceled. No ZIP was made.')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Generate Batch' })).toBeEnabled();
      expect(downloadManager.triggerFileDownload).not.toHaveBeenCalled();
      spyPreflight.mockRestore();
    });
  });
});

describe('BulkCsvInput preflight (#1481)', () => {
  it('re-checks the rows only when design text changes, not on colour or size changes', () => {
    const store: { current: QRStore | null } = { current: null };
    const Capture = () => {
      store.current = useQRStore();
      return null;
    };
    const csvContent = 'url,name\nhttps://example.com,one\nhttps://example.org,two\n';
    renderWithProvider(
      <>
        <Capture />
        <BulkCsvInput data={{ csvContent, payloadColumn: 'url', filenameColumn: 'name', exportFormat: 'png' }} onChange={vi.fn()} />
      </>
    );
    const categorize = vi.mocked(bulkCsv.categorizeCsvRows);
    const before = categorize.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    act(() => store.current?.updateConfig({ fgColor: '#123456' }));
    act(() => store.current?.updateConfig({ logoSize: 0.3 }));
    expect(categorize.mock.calls.length).toBe(before);

    act(() => store.current?.updateConfig({ frameText: 'Scan me' }));
    expect(categorize.mock.calls.length).toBe(before + 1);
  });
});

describe('Interactive CSV Column Mapping UI', () => {
  it('displays auto-matched badges and inline sample cell previews', () => {
    const csvContent = 'promo_link,member_id\nhttps://example.com/promo1,MEM001\nhttps://example.com/promo2,MEM002';
    const onChange = vi.fn();
    renderWithProvider(
      <BulkCsvInput
        data={{ csvContent, payloadColumn: 'promo_link', filenameColumn: 'member_id', exportFormat: 'png' }}
        onChange={onChange}
      />
    );

    expect(screen.getByTestId('payload-auto-matched-badge')).toHaveTextContent('Auto-matched');
    expect(screen.getByTestId('filename-auto-matched-badge')).toHaveTextContent('Auto-matched');

    expect(screen.getByTestId('bulk-payload-sample-preview')).toHaveTextContent('https://example.com/promo1');
    expect(screen.getByTestId('bulk-filename-sample-preview')).toHaveTextContent('MEM001');
  });

  it('updates badge to Mapped when a column is manually chosen', () => {
    const csvContent = 'promo_link,member_id\nhttps://example.com/promo1,MEM001';
    const onChange = vi.fn();
    renderWithProvider(
      <BulkCsvInput
        data={{ csvContent, payloadColumn: 'member_id', filenameColumn: 'promo_link', exportFormat: 'png' }}
        onChange={onChange}
      />
    );

    expect(screen.getByTestId('payload-mapped-badge')).toHaveTextContent('Mapped');
  });

  it('swaps payload and filename columns when Swap Columns button is clicked', () => {
    const csvContent = 'URL,Name\nhttps://example.com,item1';
    const onChange = vi.fn();
    renderWithProvider(
      <BulkCsvInput
        data={{ csvContent, payloadColumn: 'URL', filenameColumn: 'Name', exportFormat: 'png' }}
        onChange={onChange}
      />
    );

    const swapBtn = screen.getByRole('button', { name: 'Swap payload and filename columns' });
    fireEvent.click(swapBtn);

    expect(onChange).toHaveBeenCalledWith({ payloadColumn: 'Name', filenameColumn: 'URL' });
  });

  it('auto-matches unspecific headers using cell fallback sample inspection', () => {
    const csvContent = 'FieldA,FieldB\nID_101,https://example.com/target\nID_102,https://example.com/target2';
    const onChange = vi.fn();
    renderWithProvider(
      <BulkCsvInput
        data={{ csvContent, payloadColumn: '', filenameColumn: '', exportFormat: 'png' }}
        onChange={onChange}
      />
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ payloadColumn: 'FieldB', filenameColumn: 'FieldA' })
    );
  });
});
