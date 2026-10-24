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

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrismManifestInfo } from '@/packages/optical-transfer';
import { axe } from '../../../../tests/utils/axe';
import { SwitchOffer } from './SwitchOffer';

const offer = (overrides: Partial<PrismManifestInfo> = {}): PrismManifestInfo => ({
  sessionId: '00112233aabb',
  fingerprint: 'oak-river',
  files: [{ name: 'report.pdf', size: 10, mimeType: 'application/pdf', sha256: '00'.repeat(32) }],
  totalSize: 10,
  compression: 'none',
  symbolSize: 100,
  k: 1,
  transferLength: 10,
  encrypted: false,
  bundle: false,
  entryCount: 0,
  ...overrides,
});

describe('SwitchOffer', () => {
  it('names the other file and its transfer code, as an alert', async () => {
    const { container } = render(<SwitchOffer offer={offer()} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('switch-offer')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('switch-offer')).toHaveTextContent('report.pdf (oak-river) is also on screen.');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says "Another file" when the offer lists no files', async () => {
    const { container } = render(<SwitchOffer offer={offer({ files: [] })} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('switch-offer')).toHaveTextContent('Another file (oak-river)');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('describes a private transfer and a bundle without naming files', () => {
    const { rerender } = render(<SwitchOffer offer={offer({ encrypted: true })} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('switch-offer')).toHaveTextContent('A private transfer');
    rerender(<SwitchOffer offer={offer({ bundle: true, entryCount: 3 })} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('switch-offer')).toHaveTextContent('3 files');
    rerender(<SwitchOffer offer={offer({ bundle: true, entryCount: 0 })} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('switch-offer')).toHaveTextContent('Several files');
  });

  it('answers yes or no', () => {
    const onAnswer = vi.fn();
    render(<SwitchOffer offer={offer()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this one' }));
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });
});
