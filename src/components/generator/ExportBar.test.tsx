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
import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRType, type QRConfig } from '@/packages/core/types';
import { ToastProvider } from '@/components/ui/Toast';
import { useExportFlow } from '@/hooks/useExportFlow';
import type { ExportStatus } from '@/hooks/useQRDownload';
import { ExportBar } from './ExportBar';
import { EMPTY_STATE_ID } from './exportsOffNote';

const exportAsset = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useQRDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useQRDownload')>()),
  useQRDownload: () => ({ exportAsset }),
}));

const config: QRConfig = { ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://example.com' };

function Harness({ isEmpty = false }: { isEmpty?: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const flow = useExportFlow({ config, effectiveConfig: config, isEmpty, refused: false, previewFailure: null, verdict: 'physical-pass', health: undefined });
  return (
    <>
      {isEmpty && <p id={EMPTY_STATE_ID}>Sample Preview</p>}
      <ExportBar flow={flow} verdict="physical-pass" health={undefined} canShare rowRef={rowRef} inputFocused={false} />
    </>
  );
}

const renderBar = (isEmpty?: boolean) => render(<ToastProvider><Harness isEmpty={isEmpty} /></ToastProvider>);
const downloadButton = () => screen.getByRole('button', { name: /^Download PNG$|^Downloaded$/ });

describe('ExportBar', () => {
  beforeEach(() => {
    exportAsset.mockReset();
    exportAsset.mockImplementation(async (format: string) => ({ success: true, format }));
  });

  it('marks every export off, says why, and exports nothing while there is no content', async () => {
    renderBar(true);
    for (const button of [downloadButton(), screen.getByRole('button', { name: 'Copy QR code to clipboard' }), screen.getByRole('button', { name: 'Share QR code' })]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('aria-describedby', EMPTY_STATE_ID);
    }
    await userEvent.click(downloadButton());
    expect(exportAsset).not.toHaveBeenCalled();
  });

  it('shows the busy state on the button that is exporting', async () => {
    let finish: (status: ExportStatus) => void = () => {};
    exportAsset.mockImplementationOnce(() => new Promise<ExportStatus>((resolve) => { finish = resolve; }));
    renderBar();
    await userEvent.click(downloadButton());
    expect(downloadButton()).toHaveAttribute('aria-busy', 'true');
    await act(async () => finish({ success: true, format: 'png' }));
    expect(downloadButton()).not.toHaveAttribute('aria-busy', 'true');
  });

  it('shows Downloaded and announces it once the export finishes, with focus back on the button', async () => {
    renderBar();
    await userEvent.click(downloadButton());
    expect(await screen.findByRole('button', { name: 'Downloaded' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('PNG downloaded');
  });

  it('opens and closes the download options', async () => {
    renderBar();
    const toggle = screen.getByRole('button', { name: 'Download options' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no axe violations, with exports on or off', async () => {
    const { container, unmount } = renderBar();
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    const off = renderBar(true);
    expect(await axe(off.container)).toHaveNoViolations();
  });
});
