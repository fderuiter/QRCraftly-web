/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Page from './+Page';
import { getPageSchema } from '@/data/pageContent';

vi.mock('../../components/QRTool', () => ({
  default: ({ initialConfig }: any) => (
    <div data-testid="qr-tool-mock">
      QRTool with type: {initialConfig?.type}
    </div>
  ),
}));

describe('Meeting QR Code Page', () => {
  it('renders QRTool with Meeting configuration', () => {
    render(<Page />);
    
    const qrTool = screen.getByTestId('qr-tool-mock');
    expect(qrTool).toBeInTheDocument();
    expect(qrTool).toHaveTextContent('QRTool with type: MEETING');
  });

  it('does NOT render structured data schema with Virtual Meeting details but renders WebApplication', () => {
    // Head renders the page's structured data at prerender time (#1058).
    const json = JSON.parse(JSON.stringify(getPageSchema('/meeting-qr-code')));
    expect(json['@context']).toBe('https://schema.org');
    
    const eventObj = json['@graph'].find((item: any) => item['@type'] === 'Event');
    expect(eventObj).toBeUndefined();

    const appObj = json['@graph'].find((item: any) => Array.isArray(item['@type']) && item['@type'].includes('SoftwareApplication') && item['@type'].includes('WebApplication'));
    expect(appObj).toBeDefined();
  });
});
