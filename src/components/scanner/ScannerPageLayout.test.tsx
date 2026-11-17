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
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CloudUpload, ShieldCheck } from 'lucide-react';
import { axe } from '../../../tests/utils/axe';
import { withPageContent } from '../../../tests/utils/pageContent';
import { ScannerPageLayout } from './ScannerPageLayout';

const MOCK_PROMISES = [
  { icon: CloudUpload, title: 'Local only', text: 'Nothing uploaded to any server.' },
  { icon: ShieldCheck, title: 'Safe verification', text: 'Addresses are inspected locally.' },
] as const;

const MOCK_LINKS = [
  { href: '/test-route', label: 'Test Tool' },
  { href: '/another-route', label: 'Another Tool' },
] as const;

describe('ScannerPageLayout', () => {
  it('renders heading, description, children, promises, and related links', async () => {
    const { container } = render(
      withPageContent(
        '/qr-code-scanner',
        <ScannerPageLayout
          toolId="qr-code-scanner"
          description="Test description text for the scanner layout."
          promises={MOCK_PROMISES}
          relatedLinks={MOCK_LINKS}
        >
          <div data-testid="child-scanner">Child Scanner Component</div>
        </ScannerPageLayout>,
      ),
    );

    expect(screen.getByRole('heading', { level: 1, name: 'QR Code Scanner Online' })).toBeInTheDocument();
    expect(screen.getByText('Test description text for the scanner layout.')).toBeInTheDocument();
    expect(screen.getByTestId('child-scanner')).toBeInTheDocument();
    expect(screen.getByText('Local only')).toBeInTheDocument();
    expect(screen.getByText('Nothing uploaded to any server.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Test Tool' })).toHaveAttribute('href', '/test-route');
    expect(screen.getByRole('link', { name: 'Another Tool' })).toHaveAttribute('href', '/another-route');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('allows heading override via props', () => {
    render(
      <ScannerPageLayout
        toolId="qr-code-checker"
        heading="Custom Heading Override"
        description="Custom description."
        promises={MOCK_PROMISES}
        relatedLinks={MOCK_LINKS}
      >
        <div>Content</div>
      </ScannerPageLayout>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Custom Heading Override' })).toBeInTheDocument();
  });

  it('handles missing page content metadata safely without throwing', () => {
    // Render without withPageContent wrapper: page content context is null
    expect(() =>
      render(
        <ScannerPageLayout
          toolId="unknown-tool"
          description="Empty metadata fallback description."
          promises={MOCK_PROMISES}
          relatedLinks={MOCK_LINKS}
        >
          <div>Safe Fallback Content</div>
        </ScannerPageLayout>,
      ),
    ).not.toThrow();

    expect(screen.getByText('Empty metadata fallback description.')).toBeInTheDocument();
    expect(screen.getByText('Safe Fallback Content')).toBeInTheDocument();
  });
});
