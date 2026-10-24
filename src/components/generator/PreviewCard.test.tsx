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
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRErrorCorrectionLevel, QRType, type QRConfig } from '@/packages/core/types';
import { QRProvider } from '@/context/QRContext';
import type { GeneratorPreview } from '@/hooks/useGeneratorPreview';
import { PreviewCard } from './PreviewCard';
import { EMPTY_STATE_ID, REFUSED_STATE_ID } from './exportsOffNote';

vi.mock('@/components/QRCanvas', () => ({
  default: (props: { config: { value: string } }) => <canvas data-testid="qr-canvas-mock" data-encoded-value={props.config.value} />,
}));

const config: QRConfig = { ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://example.com' };
const preview = (overrides: Partial<GeneratorPreview> = {}): GeneratorPreview => ({
  effectiveConfig: config,
  debouncedConfig: config,
  verdict: 'physical-pass',
  health: { score: 100, warnings: [], criticalWarnings: [] },
  noVerdict: false,
  isEmpty: false,
  refused: false,
  moduleCount: 25,
  onRendered: vi.fn(),
  onRenderFailed: vi.fn(),
  previewFailure: null,
  recovering: false,
  ...overrides,
});

function renderCard(previewState: GeneratorPreview) {
  return render(
    <QRProvider initialConfig={config}>
      <PreviewCard
        canvasRef={{ current: null }}
        preview={previewState}
        errorCorrectionLevel={QRErrorCorrectionLevel.M}
        onFix={vi.fn()}
        onResetDefault={vi.fn()}
        guardExport={vi.fn()}
        exportBar={<div data-testid="export-bar" />}
      />
    </QRProvider>,
  );
}

describe('PreviewCard', () => {
  it('shows the QR, the export bar under it and the stress test for a real code', async () => {
    const { container } = renderCard(preview());
    expect(screen.getByTestId('qr-canvas-mock')).toHaveAttribute('data-encoded-value', 'https://example.com');
    expect(screen.getByTestId('qr-stage').compareDocumentPosition(screen.getByTestId('export-bar')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stress Test/i })).toBeInTheDocument();
    expect(screen.queryByTestId('sample-preview-badge')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the Sample Preview badge and no stress test for the sample', async () => {
    const { container } = renderCard(preview({ isEmpty: true, noVerdict: true, verdict: 'idle', health: undefined }));
    expect(screen.getByTestId('sample-preview-badge')).toHaveAttribute('id');
    expect(screen.queryByRole('button', { name: /Stress Test/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks to fix the highlighted field while a value is refused', async () => {
    const { container } = renderCard(preview({ refused: true, noVerdict: true, verdict: 'idle', health: undefined }));
    expect(screen.getByTestId('refused-content-badge')).toHaveAttribute('id');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a failing verdict and the recovery warning', async () => {
    const { container } = renderCard(preview({ verdict: 'fail', health: { score: 20, warnings: [], criticalWarnings: ['Low contrast'] }, recovering: true }));
    expect(screen.getByTestId('preview-status')).toHaveTextContent("Won't scan reliably");
    expect(screen.getByText(/The validator has recovered/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
