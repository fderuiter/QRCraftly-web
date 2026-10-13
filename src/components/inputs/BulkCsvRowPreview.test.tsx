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

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { BulkCsvRowPreview } from './BulkCsvRowPreview';
import type { CsvRow } from '@/packages/bulk-csv';

const rows: CsvRow[] = [
  { URL: 'https://example.com/1', Name: 'first', Note: 'a' },
  { URL: 'https://example.com/2', Name: 'second', Note: 'b' },
  { URL: 'https://example.com/3', Name: 'third', Note: 'c' },
  { URL: 'https://example.com/4', Name: 'fourth', Note: 'd' },
];
const rowNumbers = [2, 3, 5, 6];

describe('BulkCsvRowPreview', () => {
  it('shows the first three data rows under a caption, with the row numbers', () => {
    render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="Name" />);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('caption')).toHaveTextContent('First 3 rows');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(3);
    expect(within(bodyRows[0]).getByRole('rowheader')).toHaveTextContent('2');
    expect(within(bodyRows[1]).getByRole('rowheader')).toHaveTextContent('3');
    expect(within(bodyRows[2]).getByRole('rowheader')).toHaveTextContent('5');
    expect(screen.queryByText('fourth')).not.toBeInTheDocument();
  });

  it('shows the content and file name values, and labels each column header with its role', () => {
    render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="Name" />);

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Row', 'URLContent', 'NameFile name']);
    expect(screen.getByText('https://example.com/1')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
  });

  it('highlights only the content column with semantic tokens', () => {
    render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="Name" />);

    const [, contentHeader, fileHeader] = screen.getAllByRole('columnheader');
    expect(contentHeader).toHaveClass('bg-accent-soft', 'text-accent-strong');
    expect(fileHeader).not.toHaveClass('bg-accent-soft');

    const contentCell = screen.getByText('https://example.com/1').closest('td');
    const fileCell = screen.getByText('first').closest('td');
    expect(contentCell).toHaveClass('bg-accent-soft');
    expect(fileCell).not.toHaveClass('bg-accent-soft');
  });

  it('truncates long values with an ellipsis class and keeps the full text in a tooltip', () => {
    const long = 'https://example.com/' + 'x'.repeat(200);
    render(<BulkCsvRowPreview rows={[{ URL: long, Name: 'n' }]} rowNumbers={[2]} payloadColumn="URL" filenameColumn="Name" />);

    const cell = screen.getByTitle(long);
    expect(cell).toHaveClass('truncate', 'max-w-xs');
    expect(cell).toHaveTextContent(long);
  });

  it('marks blank values instead of showing an empty cell', () => {
    render(<BulkCsvRowPreview rows={[{ URL: '  ', Name: 'n' }]} rowNumbers={[2]} payloadColumn="URL" filenameColumn="Name" />);
    expect(screen.getByText('blank')).toBeInTheDocument();
  });

  it('shows a column chosen for both roles once, under the content role', () => {
    render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="URL" />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('follows the column mapping when it changes', () => {
    const { rerender } = render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="Name" />);
    expect(screen.getByText('first')).toBeInTheDocument();

    rerender(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="Note" filenameColumn="URL" />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[1]).toHaveClass('bg-accent-soft');
    expect(headers[1]).toHaveTextContent('NoteContent');
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('renders nothing without a content column or rows', () => {
    const { container, rerender } = render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="" filenameColumn="Name" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BulkCsvRowPreview rows={[]} rowNumbers={[]} payloadColumn="URL" filenameColumn="Name" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn="URL" filenameColumn="Name" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
