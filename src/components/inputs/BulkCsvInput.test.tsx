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
import { BulkCsvData, SocialFormat } from '@/types';
import { QRProvider } from '@/context/QRContext';
import { ToastProvider } from '../ui/Toast';
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

    const resSelect = screen.getByLabelText('PNG Width') as HTMLSelectElement;
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

    expect(screen.queryByLabelText('PNG Width')).not.toBeInTheDocument();
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
    expect((screen.getByLabelText('Content Type') as HTMLSelectElement).value).toBe('text');
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
    expect(await screen.findByText('Batch cancelled. No ZIP was made.')).toBeInTheDocument();
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
});
