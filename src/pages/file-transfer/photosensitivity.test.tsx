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
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from 'vitest-axe';
import { ToastProvider } from '@/components/ui/Toast';
import {
  PAUSED_ANNOUNCEMENT,
  PHOTOSENSITIVITY_NOTICE,
  REDUCED_MOTION_CONFIRM_TITLE,
} from '@/utils/photosensitivity';

/** The sender hook is replaced so the page can be driven through every state without workers. */
const sender = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  startTransfer: vi.fn(),
  stopTransfer: vi.fn(),
  pauseTransfer: vi.fn(),
  resumeTransfer: vi.fn(),
  setDensity: vi.fn(),
  setFps: vi.fn(),
}));

const helloFile = new File(['hello'], 'hello.txt', { type: 'text/plain' });
const helloFiles = [helloFile];

vi.mock('@/packages/optical-transfer/client', () => ({
  useOpticalSender: () => ({
    selectedFile: helloFile,
    selectedFiles: helloFiles,
    setSelectedFile: vi.fn(),
    setSelectedFiles: vi.fn(),
    isPrivate: false,
    setIsPrivate: vi.fn(),
    keyFrame: null,
    keyCanvasRef: { current: null },
    showKeyQr: vi.fn(),
    hideKeyQr: vi.fn(),
    isTransferring: false,
    isPaused: false,
    isVerifyingHandshake: false,
    handshakeError: null,
    progress: 0,
    currentFrameIndex: 0,
    totalFrames: 0,
    density: 'balanced',
    fps: 15,
    currentPass: 1,
    fountainInfo: null,
    steer: false,
    setSteer: vi.fn(),
    steerState: { status: 'off' },
    steeredProfile: null,
    steeringReceivers: 0,
    autoStopped: false,
    transferStats: { frameBufferMemory: '0 MB' },
    canvasRef: { current: null },
    handleFileChange: vi.fn(),
    simulate50MBFile: vi.fn(),
    ...sender.state,
    startTransfer: sender.startTransfer,
    stopTransfer: sender.stopTransfer,
    pauseTransfer: sender.pauseTransfer,
    resumeTransfer: sender.resumeTransfer,
    setDensity: sender.setDensity,
    setFps: sender.setFps,
  }),
}));

/** Emulates the `prefers-reduced-motion` media feature. */
function emulateReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })
  );
}

/** A fresh copy of the page, so the once-per-visit notice starts unseen. */
async function renderPage() {
  vi.resetModules();
  const { default: Page } = await import('./+Page');
  return render(
    <ToastProvider>
      <Page />
    </ToastProvider>
  );
}

describe('photosensitivity safeguards (#1148)', () => {
  beforeEach(() => {
    sender.state = {};
    for (const mock of [sender.startTransfer, sender.stopTransfer, sender.pauseTransfer, sender.resumeTransfer, sender.setDensity, sender.setFps]) {
      mock.mockClear();
    }
    emulateReducedMotion(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows the notice before the first start, in a live region, and starts at once otherwise', async () => {
    await renderPage();
    const notice = screen.getByTestId('photosensitivity-notice');
    expect(notice).toHaveTextContent(PHOTOSENSITIVITY_NOTICE);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    const start = screen.getByRole('button', { name: 'Start file transfer' });
    expect(start.getAttribute('aria-describedby')).toBe('photosensitivity-notice');
    // It is a plain note, not a blocking dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(start);
    expect(sender.startTransfer).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('reduced-motion-confirm')).not.toBeInTheDocument();
    // Seen: it does not come back for later transfers in this visit.
    expect(screen.queryByTestId('photosensitivity-notice')).not.toBeInTheDocument();
  });

  it('keeps the notice off later in the same visit, and stores nothing', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { rerender, unmount } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start file transfer' }));
    sender.state = { isTransferring: false };
    rerender(
      <ToastProvider>
        <div />
      </ToastProvider>
    );
    unmount();
    const { default: Page } = await import('./+Page');
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );
    expect(screen.queryByTestId('photosensitivity-notice')).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('under reduced motion, defaults to the slowest pace and asks once more before starting', async () => {
    emulateReducedMotion(true);
    await renderPage();
    expect(sender.setDensity).toHaveBeenCalledWith('reliable');
    expect(sender.setFps).toHaveBeenCalledWith(8);

    fireEvent.click(screen.getByRole('button', { name: 'Start file transfer' }));
    const confirm = screen.getByTestId('reduced-motion-confirm');
    expect(confirm).toHaveTextContent(REDUCED_MOTION_CONFIRM_TITLE);
    expect(sender.startTransfer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start anyway' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('reduced-motion-confirm')).not.toBeInTheDocument();
    expect(sender.startTransfer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start file transfer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    expect(sender.startTransfer).toHaveBeenCalledTimes(1);
  });

  it('keeps Pause visible while sending, and Pause and Escape both stop the animation', async () => {
    sender.state = { isTransferring: true };
    await renderPage();
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause).toBeVisible();
    expect(pause).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(screen.getByTestId('pause-hint')).toHaveTextContent(/Escape/);
    expect(screen.getByRole('button', { name: 'Stop file transfer' })).toBeInTheDocument();

    fireEvent.click(pause);
    expect(sender.pauseTransfer).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sender.pauseTransfer).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'a' });
    expect(sender.pauseTransfer).toHaveBeenCalledTimes(2);
  });

  it('when paused, offers Resume, announces it, and ignores Escape', async () => {
    sender.state = { isTransferring: true, isPaused: true };
    await renderPage();
    expect(screen.getByText(PAUSED_ANNOUNCEMENT).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sender.pauseTransfer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(sender.resumeTransfer).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape once the transfer ends', async () => {
    sender.state = { isTransferring: false };
    await renderPage();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(sender.pauseTransfer).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark'])('has no axe violations with the notice, the confirm and the controls in the %s theme', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    emulateReducedMotion(true);
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start file transfer' }));
    expect(screen.getByTestId('reduced-motion-confirm')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'])('has no axe violations while sending in the %s theme', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    sender.state = { isTransferring: true };
    const { container } = await renderPage();
    expect(await axe(container)).toHaveNoViolations();
  });
});
