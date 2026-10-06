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
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { ToastProvider } from '@/components/ui/Toast';
import SenderPage from './+Page';
import ReceiverPage from './receive/+Page';

function follows(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function expectSingleScrollSurface() {
  const workspace = screen.getByTestId('tool-workspace');
  for (const el of [workspace, ...Array.from(workspace.querySelectorAll('*'))]) {
    const classes = Array.from(el.classList);
    expect(classes).not.toContain('h-screen');
    expect(classes).not.toContain('max-h-[50vh]');
    expect(classes).not.toContain('overflow-y-auto');
    expect(classes).not.toContain('animate-bounce');
  }
}

describe('File transfer workspaces (#796, #978)', () => {
  it('sender: before a file, the preview is one drop zone with one action (#1055)', async () => {
    render(<ToastProvider><SenderPage /></ToastProvider>);
    const empty = screen.getByTestId('send-empty-state');
    expect(within(empty).getByRole('heading', { name: 'Drop a file to beam it' })).toBeInTheDocument();
    expect(within(empty).getAllByRole('button').map((b) => b.textContent)).toEqual(['Choose a file']);
    expect(follows(screen.getByRole('heading', { name: /2\. Transfer Settings/ }), empty)).toBe(true);
    expect(screen.queryByText(/Stream Style Preset/)).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
    expect(await axe(empty)).toHaveNoViolations();
  });

  it('sender: descriptive h1, and mobile order file > settings > Start > QR preview', () => {
    render(<ToastProvider><SenderPage /></ToastProvider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Send a File by QR Code' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expectSingleScrollSurface();

    fireEvent.change(screen.getByLabelText('Choose a file to send'), {
      target: { files: [new File(['hello'], 'hello.txt', { type: 'text/plain' })] },
    });
    expect(screen.queryByTestId('send-empty-state')).not.toBeInTheDocument();

    const choose = screen.getByRole('heading', { name: /1\. Choose a File/ });
    const settings = screen.getByRole('heading', { name: /2\. Transfer Settings/ });
    const start = screen.getByRole('button', { name: 'Start file transfer' });
    const canvas = screen.getByRole('img', { name: 'Transfer QR code' });

    expect(follows(choose, settings)).toBe(true);
    expect(follows(settings, start)).toBe(true);
    expect(follows(start, canvas)).toBe(true);
    // Transfer codes have one fixed look, so the page offers no appearance controls (#1307).
    expect(screen.queryByRole('heading', { name: /QR Appearance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pattern & Colors' })).not.toBeInTheDocument();
  });

  it('receiver: descriptive h1, and mobile order Activate Camera > viewport > progress', () => {
    render(<ToastProvider><ReceiverPage /></ToastProvider>);

    expect(screen.getByRole('heading', { level: 1, name: 'Receive a File by QR Code' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expectSingleScrollSurface();

    const activate = screen.getByRole('button', { name: 'Activate camera scanner' });
    const viewport = screen.getByRole('region', { name: 'Camera Capture Viewport' });
    const progress = screen.getByRole('heading', { name: /Transfer Progress/ });

    expect(follows(activate, viewport)).toBe(true);
    expect(follows(viewport, progress)).toBe(true);
  });

  it('receiver: the idle camera is a viewfinder with one Start camera action, and nothing to clear (#1055)', async () => {
    render(<ToastProvider><ReceiverPage /></ToastProvider>);
    const empty = screen.getByTestId('camera-empty-state');
    expect(within(empty).getByRole('heading', { name: 'Camera is off' })).toBeInTheDocument();
    expect(within(empty).getAllByRole('button').map((b) => b.textContent)).toEqual(['Start camera']);
    expect(screen.queryByRole('button', { name: 'Clear transfer progress' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(await axe(empty)).toHaveNoViolations();
  });

  it('both routes can switch to the other through the transfer mode switcher, leaving site navigation to the app shell', () => {
    render(<ToastProvider><ReceiverPage /></ToastProvider>);
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
    const modeNav = screen.getByRole('navigation', { name: 'Transfer mode' });
    expect(within(modeNav).getByRole('link', { name: /Send File/ })).toHaveAttribute('href', '/file-transfer');
    expect(within(modeNav).getByRole('link', { name: /Receive File/ })).toHaveAttribute('href', '/file-transfer/receive');
  });
});
