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

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import type { ReceiverPhase, ReceiverResult } from '@/packages/optical-transfer';
import { completionView, TransferCompletionSkeleton } from './completionView';

const handlers = {
  saved: false,
  onSaveFile: vi.fn(),
  onSaveAll: vi.fn(),
  onReceiveAnother: vi.fn(),
};

describe('TransferCompletionSkeleton', () => {
  it('renders the skeleton with status role, aria-busy, and pulse animations', () => {
    const { container } = render(<TransferCompletionSkeleton />);
    const skeletonPanel = screen.getByTestId('transfer-completion-skeleton');
    expect(skeletonPanel).toHaveAttribute('role', 'status');
    expect(skeletonPanel).toHaveAttribute('aria-busy', 'true');
    expect(skeletonPanel).toHaveAttribute('aria-label', 'Loading transfer completion');
    expect(skeletonPanel).toHaveClass('flex', 'size-full', 'flex-col', 'items-center', 'justify-center', 'bg-surface-sunken');

    const pulsingElements = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsingElements.length).toBeGreaterThanOrEqual(5);
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<TransferCompletionSkeleton />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('completionView', () => {
  it('returns null for non-complete receiver phases', () => {
    const nonCompletePhases: ReceiverPhase[] = [
      'idle',
      'awaitingVideo',
      'scanning',
      'needsKey',
      'receiving',
      'verifying',
      'failed',
    ];

    for (const phase of nonCompletePhases) {
      expect(completionView(phase, null, null, handlers)).toBeNull();
    }
  });

  it('returns null when complete but result is null', () => {
    expect(completionView('complete', null, null, handlers)).toBeNull();
  });

  it('uses TransferCompletionSkeleton as Suspense fallback and renders skeleton while lazy component resolves', async () => {
    const result: ReceiverResult = {
      kind: 'file',
      data: new Uint8Array([1, 2, 3, 4]),
      handshake: {
        fileName: 'test-file.txt',
        fileSize: 4,
        mimeType: 'text/plain',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    };

    const view = completionView('complete', result, null, handlers);
    expect(view).not.toBeNull();

    render(view);
    expect(screen.getByTestId('transfer-completion-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('received-file-summary')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('transfer-completion-skeleton')).not.toBeInTheDocument();
  });

  it('renders skeleton fallback and resolves for bundle transfers', async () => {
    const result: ReceiverResult = {
      kind: 'bundle',
      files: [
        {
          name: 'doc.txt',
          mimeType: 'text/plain',
          size: 7,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    };

    const view = completionView('complete', result, null, handlers);
    expect(view).not.toBeNull();

    render(view);
    expect(screen.getByTestId('transfer-completion-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('received-file-list')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('transfer-completion-skeleton')).not.toBeInTheDocument();
  });

  it('renders skeleton fallback and resolves for BC-UR transfers', async () => {
    const bcur = {
      type: 'bytes',
      cbor: new Uint8Array([0xa0]),
      content: {
        kind: 'text' as const,
        text: 'hello bcur',
      },
    };

    const view = completionView('complete', null, bcur, handlers);
    expect(view).not.toBeNull();

    render(view);
    expect(screen.getByTestId('transfer-completion-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('bcur-complete-panel')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('transfer-completion-skeleton')).not.toBeInTheDocument();
  });
});
