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
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BulkCsvPreflightSummary } from './BulkCsvPreflightSummary';
import { type PreflightReport } from '@/packages/bulk-csv';

describe('BulkCsvPreflightSummary Component', () => {
  it('renders all-valid preflight report cleanly', () => {
    const report: PreflightReport = {
      totalRows: 10,
      validCount: 10,
      emptyCount: 0,
      unsafeCount: 0,
      cautionCount: 0,
      details: [],
      invalidDetails: [],
      validRows: [],
      validRowIndices: [],
      validPayloads: [],
    };

    render(<BulkCsvPreflightSummary report={report} />);

    expect(screen.getByText('All 10 rows valid')).toBeInTheDocument();
    expect(screen.getByTestId('count-total')).toHaveTextContent('10');
    expect(screen.getByTestId('count-valid')).toHaveTextContent('10');
    expect(screen.getByTestId('count-empty')).toHaveTextContent('0');
    expect(screen.getByTestId('count-unsafe')).toHaveTextContent('0');
    expect(screen.getByTestId('count-caution')).toHaveTextContent('0');
    expect(screen.queryByTestId('preflight-expand-toggle')).not.toBeInTheDocument();
  });

  it('renders report with issues and allows expanding/collapsing row details', () => {
    const report: PreflightReport = {
      totalRows: 10,
      validCount: 7,
      emptyCount: 1,
      unsafeCount: 1,
      cautionCount: 1,
      details: [],
      invalidDetails: [
        { rowNumber: 2, category: 'empty', reason: 'Missing payload value' },
        { rowNumber: 5, category: 'unsafe', reason: 'Dangerous javascript: scheme' },
        { rowNumber: 8, category: 'caution', reason: 'Domain lookalike detected' },
      ],
      validRows: [],
      validRowIndices: [],
      validPayloads: [],
    };

    render(<BulkCsvPreflightSummary report={report} />);

    expect(screen.getByText('3 rows require attention')).toBeInTheDocument();
    expect(screen.getByTestId('count-total')).toHaveTextContent('10');
    expect(screen.getByTestId('count-valid')).toHaveTextContent('7');
    expect(screen.getByTestId('count-empty')).toHaveTextContent('1');
    expect(screen.getByTestId('count-unsafe')).toHaveTextContent('1');
    expect(screen.getByTestId('count-caution')).toHaveTextContent('1');

    const toggleBtn = screen.getByTestId('preflight-expand-toggle');
    expect(toggleBtn).toHaveTextContent('View 3 Problematic Rows');

    // Panel is initially collapsed
    expect(screen.queryByTestId('preflight-details-list')).not.toBeInTheDocument();

    // Expand panel
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId('preflight-details-list')).toBeInTheDocument();
    expect(screen.getByText('Row 2:')).toBeInTheDocument();
    expect(screen.getByText('Missing payload value')).toBeInTheDocument();
    expect(screen.getByText('Dangerous javascript: scheme')).toBeInTheDocument();
    expect(screen.getByText('Domain lookalike detected')).toBeInTheDocument();

    // Collapse panel
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId('preflight-details-list')).not.toBeInTheDocument();
  });
});
