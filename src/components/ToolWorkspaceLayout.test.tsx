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

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { ToolWorkspaceLayout, ToolWorkspaceHeader, DESKTOP_WORKSPACE_QUERY } from './ToolWorkspaceLayout';

type Listener = () => void;

function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initialMatches,
    media: DESKTOP_WORKSPACE_QUERY,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    set(matches: boolean) {
      query.matches = matches;
      listeners.forEach((l) => l());
    },
  };
}

function renderWorkspace() {
  return render(
    <ToolWorkspaceLayout
      controlsLabel="Tool settings"
      previewLabel="Tool preview"
      previewId="tool-preview"
      header={<ToolWorkspaceHeader title="Send a File by QR Code" subtitle="Stream a file" badge="Beta" previewId="tool-preview" />}
      controls={<p>Primary controls</p>}
      preview={<p>Preview surface</p>}
      secondary={<p>Secondary controls</p>}
    />
  );
}

describe('ToolWorkspaceLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('orders primary controls, preview, then secondary controls in the document (mobile order)', () => {
    mockMatchMedia(false);
    renderWorkspace();
    const primary = screen.getByText('Primary controls');
    const preview = screen.getByText('Preview surface');
    const secondary = screen.getByText('Secondary controls');
    expect(primary.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps mobile in normal document flow with no viewport-height panes or nested scrolling', () => {
    mockMatchMedia(false);
    renderWorkspace();
    const workspace = screen.getByTestId('tool-workspace');
    const all = [workspace, ...Array.from(workspace.querySelectorAll<HTMLElement>('*'))];
    for (const el of all) {
      const classes = Array.from(el.classList);
      expect(classes).not.toContain('h-screen');
      expect(classes).not.toContain('max-h-[50vh]');
      expect(classes).not.toContain('overflow-hidden');
      expect(classes).not.toContain('overflow-y-auto');
      expect(classes).not.toContain('overflow-x-hidden');
    }
    // Sticky, viewport-height scrolling is desktop-only.
    const scroller = screen.getByTestId('tool-workspace-preview-scroller');
    expect(scroller).toHaveClass('md:sticky', 'md:h-dvh', 'md:overflow-y-auto');
  });

  it('resets retained preview scroll when the viewport shrinks from desktop to mobile', () => {
    const media = mockMatchMedia(true);
    renderWorkspace();
    const scroller = screen.getByTestId('tool-workspace-preview-scroller');
    scroller.scrollTop = 240;
    expect(scroller.scrollTop).toBe(240);
    media.set(false);
    expect(scroller.scrollTop).toBe(0);
  });

  it('renders a descriptive h1 and a mobile jump link, leaving site navigation to the app shell to the preview', async () => {
    mockMatchMedia(false);
    const { container } = renderWorkspace();
    expect(screen.getByRole('heading', { level: 1, name: 'Send a File by QR Code' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'QRCraftly Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
    const jump = screen.getByRole('link', { name: 'Jump to preview' });
    expect(jump).toHaveAttribute('href', '#tool-preview');
    expect(jump).toHaveClass('md:hidden');
    expect(screen.getByRole('region', { name: 'Tool preview' })).toHaveAttribute('id', 'tool-preview');
    expect(within(screen.getByRole('complementary', { name: 'Tool settings' })).getByText('Primary controls')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
