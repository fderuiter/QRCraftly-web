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
import React, { useEffect } from 'react';
import { ToastProvider } from './ui/Toast';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import QRTool from './QRTool';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import jsQR from 'jsqr';
import { renderToString } from 'react-dom/server';
import { contentRegistry } from '@/data/contentRegistry';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { pageCopy } from '../../tests/utils/pageCopy';
import { axe } from 'vitest-axe';

vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

// Mock QRCanvas because it uses canvas which is hard to test in jsdom,
// and we want to test App logic not the library
vi.mock('./QRCanvas', () => ({
  default: ({ onRendered }: { onRendered?: (info: any) => void }) => {
    return (
      <div data-testid="qr-canvas-mock">
        <canvas data-testid="mock-canvas" />
        <button
          type="button"
          data-testid="mock-trigger-rendered"
          onClick={() => onRendered?.({ moduleCount: 25, virtualImageData: new ImageData(new Uint8ClampedArray(40000), 100, 100) })}
        />
      </div>
    );
  }
}));

/** The Download button, whatever format it currently exports. */
const downloadButton = () => screen.getByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ });

/**
 * Picks a format in the Download options, then presses Download.
 * @param label - Format label as shown in the options.
 */
function downloadAs(label: 'PNG' | 'JPEG' | 'WebP' | 'SVG') {
  fireEvent.click(screen.getByRole('button', { name: 'Download options' }));
  fireEvent.click(screen.getByRole('radio', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: `Download ${label}` }));
}

/** Text of the export row's polite status region. */
const exportStatus = () => within(screen.getByTestId('export-actions')).getByRole('status').textContent;

describe('QRTool Component', () => {
  // The scene view is lazy. Load it up front so a busy CI machine does not outlast findByTestId's wait.
  beforeAll(async () => {
    await import('./mockups/MockupView');
  }, 30_000);

  // Store original globals
  const originalShowSaveFilePicker = (global as any).showSaveFilePicker;

  beforeEach(() => {
    vi.mocked(jsQR).mockReturnValue({ data: 'https://qrcraftly.com' } as any);

    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock Canvas toDataURL and toBlob
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(['mock']), 'image/png'));
  });

  afterEach(() => {
    vi.restoreAllMocks();

    // Restore globals
    if (originalShowSaveFilePicker) {
        (global as any).showSaveFilePicker = originalShowSaveFilePicker;
    } else {
        delete (global as any).showSaveFilePicker;
    }

    // We can't strictly delete navigator usually, but we can try to reset props
    // We should assume tests are independent enough or manually clean up changes

    cleanup();
  });

  it('renders without crashing', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    expect(screen.getByRole('heading', { level: 1, name: 'Free QR Code Generator' })).toBeInTheDocument();
    expect(screen.getByText('No sign-up, no ads, never expires.')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows the live code in a scene below the export row only after a view other than Flat is chosen', async () => {
    render(<ToastProvider><QRTool initialConfig={{ value: 'https://example.com' }} /></ToastProvider>);
    const views = within(screen.getByRole('radiogroup', { name: 'In the wild' }));
    expect(views.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label') ?? radio.textContent)).toEqual(['Flat', 'Poster', 'Card', 'Table tent', 'Screen', 'Sticker']);
    expect(views.getByRole('radio', { name: 'Flat' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('mockup-view')).not.toBeInTheDocument();

    fireEvent.click(views.getByRole('radio', { name: 'Table tent' }));
    expect(await screen.findByTestId('mockup-view', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /table tent/i })).toBeInTheDocument();
    // The flat preview stays on screen above: the scene copies from it and the exports read it.
    expect(screen.getByTestId('qr-stage')).toBeVisible();

    fireEvent.click(views.getByRole('radio', { name: 'Flat' }));
    expect(screen.queryByTestId('mockup-view')).not.toBeInTheDocument();
  });

  it('leaves site navigation, the theme toggle and the footer to the app shell', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Theme: / })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('offers "Stress Test in Arcade" in the live preview card', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    const preview = screen.getByRole('region', { name: 'QR Code Preview' });
    expect(within(preview).getByRole('button', { name: 'Stress Test in Arcade' })).toBeInTheDocument();
  });

  it('labels the help link by its in-page destination', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    expect(screen.queryByRole('link', { name: 'About QRCraftly' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to use' })).toHaveAttribute('href', '#content-section');
  });

  it('applies initial config if provided', () => {
      const initialConfig = { value: 'https://initial-test.com' };
      render(<ToastProvider><QRTool initialConfig={initialConfig} /></ToastProvider>);
      // We check if the input panel reflects this value.
      // Since InputPanel is not mocked here (we want to test integration), we check the input value.
      const urlInput = screen.getByDisplayValue('https://initial-test.com');
      expect(urlInput).toBeInTheDocument();
  });

  it('renders no page-local dark wrapper', () => {
    const { container } = render(<ToastProvider><QRTool /></ToastProvider>);
    const appDiv = container.firstChild as HTMLElement;
    expect(appDiv).not.toHaveClass('dark');
  });

  it('renders InputPanel and StyleControls', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    const contentHeaders = screen.getAllByText('Content');
    expect(contentHeaders[0]).toBeInTheDocument();

    const appearanceHeaders = screen.getAllByText('Appearance');
    expect(appearanceHeaders[0]).toBeInTheDocument();
  });

  it('renders Preview Area', () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    const elements = screen.getAllByText('Live Preview');
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]).toBeInTheDocument();

    const canvasMocks = screen.getAllByTestId('qr-canvas-mock');
    expect(canvasMocks[0]).toBeInTheDocument();
  });

  it('offers format, size, print, file name and Copy as SVG in the Download options (#1052)', async () => {
    render(<ToastProvider><QRTool initialConfig={{ value: 'https://www.example.com/path' }} /></ToastProvider>);
    expect(downloadButton()).toHaveClass('bg-action');
    const options = screen.getByRole('button', { name: 'Download options' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(options);
    expect(options).toHaveAttribute('aria-expanded', 'true');

    const panel = screen.getByRole('group', { name: 'Download options' });
    expect(within(panel).getAllByRole('radio').map((r) => r.textContent)).toEqual(['PNG', 'SVG', 'JPEG', 'WebP', 'Screen', 'Print', 'Poster', 'Custom']);
    fireEvent.click(within(panel).getByRole('radio', { name: 'PNG' }));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Print' }));
    expect(screen.getByTestId('print-hint')).toHaveTextContent('2048 px wide. Prints 17.3 cm (6.8 in) wide at 300 dpi and scans from about 1.7 m.');
    expect(within(panel).getByLabelText('File name')).toHaveValue('url-example.com');
    expect(within(panel).getByRole('button', { name: 'Copy as SVG' })).toBeInTheDocument();

    // SVG has no pixel size.
    fireEvent.click(within(panel).getByRole('radio', { name: 'SVG' }));
    expect(within(panel).getByText(/SVG is vector/)).toBeInTheDocument();
    expect(screen.queryByTestId('print-hint')).not.toBeInTheDocument();
    expect(downloadButton()).toHaveTextContent('Download SVG');
    expect(await axe(screen.getByTestId('export-actions'))).toHaveNoViolations();

    // Escape closes the options and returns focus to their button.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Download options' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(options);
    downloadAs('PNG');
  });

  it('exports a PNG at the selected pixel size with the chosen file name, and confirms on the button (#1052)', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const drawImage = vi.fn();
    render(<ToastProvider><QRTool initialConfig={{ value: 'https://example.com' }} /></ToastProvider>);
    // Canvases created from now on are the scaled export copies.
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = createElement(tag, options);
      if (tag === 'canvas') {
        Object.defineProperty(el, 'getContext', { value: () => ({ drawImage, imageSmoothingEnabled: true }) });
      }
      return el;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download options' }));
    const options = within(screen.getByRole('group', { name: 'Download options' }));
    fireEvent.click(options.getByRole('radio', { name: 'PNG' }));
    // "Poster" is also a preview view, so pick the size preset from inside the options.
    fireEvent.click(options.getByRole('radio', { name: 'Poster' }));
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'my code' } });
    fireEvent.click(downloadButton());

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const scaled = drawImage.mock.calls[0];
    // drawImage(source, x, y, width, height): the copy is 4096 px wide.
    expect(scaled[3]).toBe(4096);
    const link = appendSpy.mock.calls.map((c) => c[0]).find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
    expect(link?.download).toBe('my-code.png');
    expect(await screen.findByRole('button', { name: 'Downloaded' })).toBeInTheDocument();
    expect(exportStatus()).toBe('PNG downloaded');
    // No success toast.
    expect(screen.queryByText(/exported successfully/)).not.toBeInTheDocument();
  });

  it.each(['PNG', 'JPEG', 'WebP', 'SVG'] as const)('waits until an unsafe %s export is started before showing the safety warning', (format) => {
    render(
      <ToastProvider>
        <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
      </ToastProvider>
    );

    expect(downloadButton()).toHaveClass('bg-danger-action');

    fireEvent.click(screen.getByRole('button', { name: 'Download options' }));
    fireEvent.click(screen.getByRole('radio', { name: format }));
    expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Download ${format}` }));
    expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();
  });

  it.each([
    'Copy QR code to clipboard',
  ])('uses the unsafe export policy for %s', (name) => {
    render(
      <ToastProvider>
        <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name }));

    expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();
  });

  it('when scannability is unsafe and user clicks "Export Anyway" from the dropdown menu, download succeeds with allowUnsafe bypass', async () => {
    vi.mocked(jsQR).mockReturnValue(null);
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    render(
      <ToastProvider>
        <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
      </ToastProvider>
    );

    // 1-2. Start a PNG download
    downloadAs('PNG');

    // 3. Scan Safety Warning modal opens
    expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();

    // 4. Click "Export Anyway"
    const exportAnywayBtn = screen.getByRole('button', { name: 'Export Anyway' });
    fireEvent.click(exportAnywayBtn);

    // 5. Modal closes and download succeeds
    await waitFor(() => {
      expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();
    });

    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText(/SCAN_VALIDATION_FAILED/i)).not.toBeInTheDocument();
      const statuses = screen.getAllByRole('status');
      expect(statuses.some(s => s.textContent === 'PNG downloaded')).toBe(true);
    });
  });

  it('when scannability is unsafe and user clicks "Export Anyway" for SVG, vector export succeeds', async () => {
    vi.mocked(jsQR).mockReturnValue(null);
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    render(
      <ToastProvider>
        <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
      </ToastProvider>
    );

    // 1-2. Start an SVG download
    downloadAs('SVG');

    // 3. Scan Safety Warning modal opens
    expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();

    // 4. Click "Export Anyway"
    const exportAnywayBtn = screen.getByRole('button', { name: 'Export Anyway' });
    fireEvent.click(exportAnywayBtn);

    // 5. Modal closes and download succeeds
    await waitFor(() => {
      expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();
    });

    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText(/SCAN_VALIDATION_FAILED/i)).not.toBeInTheDocument();
      const statuses = screen.getAllByRole('status');
      expect(statuses.some(s => s.textContent === 'SVG downloaded')).toBe(true);
    });
  });

  it('when scannability is unsafe and user clicks "Export Anyway" for Copy, clipboard copy succeeds', async () => {
    vi.mocked(jsQR).mockReturnValue(null);
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = global.navigator.clipboard;
    const originalClipboardItem = (global as any).ClipboardItem;
    Object.defineProperty(global.navigator, 'clipboard', {
      value: { write: mockWrite },
      writable: true,
      configurable: true,
    });
    (global as any).ClipboardItem = vi.fn().mockImplementation(function(this: any, data) { this.data = data; });

    try {
      render(
        <ToastProvider>
          <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
        </ToastProvider>
      );

      // 1. Click Copy button
      const copyBtn = screen.getByRole('button', { name: 'Copy QR code to clipboard' });
      fireEvent.click(copyBtn);

      // 2. Modal opens
      expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();

      // 3. Click "Export Anyway"
      const exportAnywayBtn = screen.getByRole('button', { name: 'Export Anyway' });
      fireEvent.click(exportAnywayBtn);

      // 4. Modal closes and copy succeeds
      await waitFor(() => {
        expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.queryByText(/SCAN_VALIDATION_FAILED/i)).not.toBeInTheDocument();
        const statuses = screen.getAllByRole('status');
        expect(statuses.some(s => s.textContent === 'Copied')).toBe(true);
      });
    } finally {
      Object.defineProperty(global.navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
      (global as any).ClipboardItem = originalClipboardItem;
    }
  });

  it('when scannability is unsafe and user clicks "Export Anyway" for Share, Web Share succeeds', async () => {
    vi.mocked(jsQR).mockReturnValue(null);
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);
    const originalShare = global.navigator.share;
    const originalCanShare = global.navigator.canShare;

    Object.defineProperty(global.navigator, 'share', {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'canShare', {
      value: mockCanShare,
      writable: true,
      configurable: true,
    });

    try {
      render(
        <ToastProvider>
          <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
        </ToastProvider>
      );

      // 1. Click Share button
      const shareBtn = screen.getByRole('button', { name: 'Share QR code' });
      fireEvent.click(shareBtn);

      // 2. Modal opens
      expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();

      // 3. Click "Export Anyway"
      const exportAnywayBtn = screen.getByRole('button', { name: 'Export Anyway' });
      fireEvent.click(exportAnywayBtn);

      // 4. Modal closes and share succeeds
      await waitFor(() => {
        expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.queryByText(/SCAN_VALIDATION_FAILED/i)).not.toBeInTheDocument();
        const statuses = screen.getAllByRole('status');
        expect(statuses.some(s => s.textContent === 'Shared')).toBe(true);
      });
    } finally {
      Object.defineProperty(global.navigator, 'share', {
        value: originalShare,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global.navigator, 'canShare', {
        value: originalCanShare,
        writable: true,
        configurable: true,
      });
    }
  });

  it('downloads a PNG from the Download menu', async () => {
     render(<ToastProvider><QRTool /></ToastProvider>);

     // Spy on document.createElement but we can't easily mock return value without affecting internal React logic if it uses 'a' tags (it might)
     // Instead, spy on appendChild.
     const appendSpy = vi.spyOn(document.body, 'appendChild');
     const removeSpy = vi.spyOn(document.body, 'removeChild');

     // We rely on the fact that the component calls `click()` on the created element.
     // Since we don't control the creation, the created element is a real HTMLAnchorElement.
     // `click()` on a real element in JSDOM doesn't do much unless we listen for it, or spy on it.
     // But we can't spy on it before it's created.
     // BUT, we can inspect the element PASSED to appendChild.
     // And check its attributes.

     // To verify click, we can spy on HTMLAnchorElement.prototype.click
     const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

     downloadAs('PNG');

     // The export check loads on demand, so the download follows a moment later.
     await waitFor(() => expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png'));

     expect(appendSpy).toHaveBeenCalled();
     const appendedElement = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
     expect(appendedElement.tagName).toBe('A');
     expect(appendedElement.download).toContain('.png');

     expect(clickSpy).toHaveBeenCalled();
     expect(removeSpy).toHaveBeenCalledWith(appendedElement);
  });

  it('handles handleSaveAs with File System Access API', async () => {
    const mockHandle = {
        createWritable: vi.fn().mockResolvedValue({
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
        }),
    };
    const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

    // Manual mock
    Object.defineProperty(global, 'showSaveFilePicker', {
        value: showSaveFilePicker,
        writable: true,
        configurable: true
    });

    render(<ToastProvider><QRTool /></ToastProvider>);
    downloadAs('PNG');

    await waitFor(() => {
        expect(showSaveFilePicker).toHaveBeenCalled();
        expect(mockHandle.createWritable).toHaveBeenCalled();
    });
  });

  it('handles AbortError in handleSaveAs gracefully', async () => {
      // Simulate user cancelling the picker
      const showSaveFilePicker = vi.fn().mockRejectedValue({ name: 'AbortError' });

      Object.defineProperty(global, 'showSaveFilePicker', {
          value: showSaveFilePicker,
          writable: true,
          configurable: true
      });

      // Spy on downloadToDevice (by spying on anchor click)
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

      render(<ToastProvider><QRTool /></ToastProvider>);
      downloadAs('PNG');

      await waitFor(() => {
          expect(showSaveFilePicker).toHaveBeenCalled();
      });

      // Should NOT fall back to downloadToDevice for AbortError
      expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to download if File System Access API fails/missing', async () => {
      // Ensure showSaveFilePicker is NOT present
      if ((global as any).showSaveFilePicker) {
          delete (global as any).showSaveFilePicker;
      }

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
      const appendSpy = vi.spyOn(document.body, 'appendChild');

      render(<ToastProvider><QRTool /></ToastProvider>);
      downloadAs('PNG');

      await waitFor(() => {
          expect(clickSpy).toHaveBeenCalled();
          expect(appendSpy).toHaveBeenCalled();
      });
  });

  it('handles Web Share API', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      const mockCanShare = vi.fn().mockReturnValue(true);

      Object.defineProperty(global.navigator, 'share', {
          value: mockShare,
          writable: true,
          configurable: true
      });
      Object.defineProperty(global.navigator, 'canShare', {
          value: mockCanShare,
          writable: true,
          configurable: true
      });

      render(<ToastProvider><QRTool /></ToastProvider>);
      const shareBtn = screen.getByRole('button', { name: 'Share QR code' });
      fireEvent.click(shareBtn);

      await waitFor(() => {
          expect(mockShare).toHaveBeenCalled();
      });
  });

  it('uses the unsafe export policy for Web Share', () => {
      Object.defineProperty(global.navigator, 'share', {
          value: vi.fn().mockResolvedValue(undefined),
          writable: true,
          configurable: true
      });
      Object.defineProperty(global.navigator, 'canShare', {
          value: vi.fn().mockReturnValue(true),
          writable: true,
          configurable: true
      });

      render(
        <ToastProvider>
          <QRTool initialConfig={{ fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' }} />
        </ToastProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Share QR code' }));

      expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();
  });

  it('does not render share button if Web Share API is not supported', async () => {
    // Set share to undefined
    Object.defineProperty(global.navigator, 'share', {
        value: undefined,
        writable: true,
        configurable: true
    });

    render(<ToastProvider><QRTool /></ToastProvider>);
    
    // the share button should not be found
    const shareBtn = screen.queryByTitle('Share');
    expect(shareBtn).toBeNull();
  });

  it('catches blob creation failure in handleSaveAs', async () => {
      // Mock toBlob to fail
      HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(null as any, 'image/png'));
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Force fallback path by mocking showSaveFilePicker as failing
      const showSaveFilePicker = vi.fn().mockRejectedValue(new Error('Nope'));
      Object.defineProperty(global, 'showSaveFilePicker', {
          value: showSaveFilePicker,
          writable: true,
          configurable: true
      });

      // downloadToDevice should be called as fallback (or nothing if blob fails early?)
      // Wait, if toBlob returns null, handleSaveAs returns early (line 98: if (!blob) throw...)
      // The error is caught in catch block.
      // If fs access is available, it goes to catch.

      // Let's test the path where showSaveFilePicker is available but blob creation fails
      render(<ToastProvider><QRTool /></ToastProvider>);
      downloadAs('PNG');

      await waitFor(() => {
         // It should catch the error "Failed to create image blob" and log warning then fallback
         expect(consoleWarn).toHaveBeenCalled();
      });
  });

  it('updates configuration when InputPanel triggers onChange', async () => {
     // Integration test to verify config propagation
     render(<ToastProvider><QRTool /></ToastProvider>);
     const urlInput = screen.getByLabelText('Website URL');
     fireEvent.change(urlInput, { target: { value: 'https://propagate.com' } });

     // The QRCanvas should receive the new config
     // Since QRCanvas is mocked, we can check if it re-rendered with new props?
     // Or we can check if the input value persisted.

     expect(urlInput).toHaveValue('https://propagate.com');
  });

  describe('Accessibility - Focus Recovery and Toast Announcements', () => {
    it('restores focus and confirms once on the button when copy QR code is triggered', async () => {
      // Mock Clipboard API for this test
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      const originalClipboard = global.navigator.clipboard;
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { write: mockWrite },
        writable: true,
        configurable: true,
      });

      const originalClipboardItem = (global as any).ClipboardItem;
      const MockClipboardItem = vi.fn().mockImplementation(function(this: any, data) { this.data = data; });
      (global as any).ClipboardItem = MockClipboardItem;

      try {
        render(<ToastProvider><QRTool /></ToastProvider>);
        const copyBtn = screen.getByRole('button', { name: 'Copy QR code to clipboard' });

        // Set focus to the copy button to simulate keyboard/user focus
        copyBtn.focus();
        expect(document.activeElement).toBe(copyBtn);

        fireEvent.click(copyBtn);

        // One confirmation: the button turns into "Copied" and the status region says so; no toast.
        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Copied' })).toBe(copyBtn);
        });
        expect(exportStatus()).toBe('Copied');
        expect(screen.queryByText(/copied to clipboard!/)).not.toBeInTheDocument();

        // Verify focus is recovered/preserved on the copy button
        expect(document.activeElement).toBe(copyBtn);
      } finally {
        (global as any).ClipboardItem = originalClipboardItem;
        Object.defineProperty(global.navigator, 'clipboard', {
          value: originalClipboard,
          writable: true,
          configurable: true,
        });
      }
    });

    it('restores focus and announces politely when a PNG download is triggered', async () => {
      render(<ToastProvider><QRTool /></ToastProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Download options' }));
      fireEvent.click(screen.getByRole('radio', { name: 'PNG' }));
      const downloadBtn = downloadButton();

      downloadBtn.focus();
      expect(document.activeElement).toBe(downloadBtn);

      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(exportStatus()).toBe('PNG downloaded');
      });

      // Verify focus is restored to the Download button
      expect(document.activeElement).toBe(downloadBtn);
    });

    it('restores focus and announces politely when an SVG download is triggered', async () => {
      render(<ToastProvider><QRTool /></ToastProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Download options' }));
      fireEvent.click(screen.getByRole('radio', { name: 'SVG' }));
      const downloadBtn = downloadButton();

      // Set focus to the Download button
      downloadBtn.focus();
      expect(document.activeElement).toBe(downloadBtn);
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(exportStatus()).toBe('SVG downloaded');
      });

      // Verify focus is returned to the main Download trigger button
      expect(document.activeElement).toBe(downloadBtn);
    });

    it('triggers a warning toast when SVG download is triggered and remote logo fetch fails', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      } as any);

      try {
        const initialConfig = {
          logoUrl: 'https://example.com/blocked-by-cors-logo.png',
        };
        render(<ToastProvider><QRTool initialConfig={initialConfig} /></ToastProvider>);
        downloadAs('SVG');
        const downloadBtn = downloadButton();

        // Verify warning toast exists with role="alert" and the expected warning message
        await waitFor(() => {
          const alerts = screen.getAllByRole('alert');
          const hasText = alerts.some(a => a.textContent?.includes('The remote logo was omitted from the SVG export due to connection or security limits. Try uploading a local image file instead.'));
          expect(hasText).toBe(true);
        });

        // Verify focus is returned to the main Download trigger button
        expect(document.activeElement).toBe(downloadBtn);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('restores focus and confirms politely when Web Share API is triggered', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      const mockCanShare = vi.fn().mockReturnValue(true);
      const originalShare = global.navigator.share;
      const originalCanShare = global.navigator.canShare;

      Object.defineProperty(global.navigator, 'share', {
          value: mockShare,
          writable: true,
          configurable: true
      });
      Object.defineProperty(global.navigator, 'canShare', {
          value: mockCanShare,
          writable: true,
          configurable: true
      });

      try {
        render(<ToastProvider><QRTool /></ToastProvider>);
        const shareBtn = screen.getByRole('button', { name: 'Share QR code' });

        // Focus the share button
        shareBtn.focus();
        expect(document.activeElement).toBe(shareBtn);

        fireEvent.click(shareBtn);

        await waitFor(() => {
          expect(exportStatus()).toBe('Shared');
        });

        // Focus is returned/preserved on the share button
        expect(document.activeElement).toBe(shareBtn);
      } finally {
        Object.defineProperty(global.navigator, 'share', {
            value: originalShare,
            writable: true,
            configurable: true
        });
        Object.defineProperty(global.navigator, 'canShare', {
            value: originalCanShare,
            writable: true,
            configurable: true
        });
      }
    });
  });

  describe('Scannability Recovery Actions', () => {
    // The failing check settles after the worker round trip and the main-thread fallback:
    // about 0.6s locally and well past the 1s findBy default on loaded CI runners.
    const SCANNABILITY_FAIL_TIMEOUT_MS = 5000;

    it('updates configuration when user applies the suggested contrast fix', async () => {
      vi.mocked(jsQR).mockReturnValue(null); // Force scan verification failure

      render(
        <ToastProvider>
          <QRTool initialConfig={{ fgColor: '#cccccc', eyeColor: '#cccccc', bgColor: '#ffffff' }} />
        </ToastProvider>
      );

      // Trigger canvas render in mock
      fireEvent.click(screen.getByTestId('mock-trigger-rendered'));

      // Wait for the failing verdict, then open its details panel
      fireEvent.click(await screen.findByRole('button', { name: /Won't scan reliably/ }, { timeout: SCANNABILITY_FAIL_TIMEOUT_MS }));
      const autoFixBtn = screen.getByRole('button', { name: 'Use black on white' });

      fireEvent.click(autoFixBtn);

      // Verify that colors are updated to high-contrast defaults (#000000 / #ffffff)
      await waitFor(() => {
        const fgInput = screen.getByLabelText('Foreground');
        const bgInput = screen.getByLabelText('Background');
        expect(fgInput).toHaveValue('#000000');
        expect(bgInput).toHaveValue('#ffffff');
      });
    });

    it('updates configuration when user resets the colours', async () => {
      vi.mocked(jsQR).mockReturnValue(null); // Force scan verification failure

      render(
        <ToastProvider>
          <QRTool initialConfig={{ fgColor: '#e0e0e0', eyeColor: '#e0e0e0', bgColor: '#ffffff' }} />
        </ToastProvider>
      );

      fireEvent.click(screen.getByTestId('mock-trigger-rendered'));

      fireEvent.click(await screen.findByRole('button', { name: /Won't scan reliably/ }, { timeout: SCANNABILITY_FAIL_TIMEOUT_MS }));
      const resetBtn = screen.getByRole('button', { name: 'Reset colours' });

      fireEvent.click(resetBtn);

      await waitFor(() => {
        const fgInput = screen.getByLabelText('Foreground');
        const bgInput = screen.getByLabelText('Background');
        expect(fgInput).toHaveValue('#000000');
        expect(bgInput).toHaveValue('#ffffff');
      });
    });
  });
});


function headingLevels(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]));
}

describe('Generator workspace structure (#795, #802)', { timeout: 20000 }, () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('puts content entry first, then the preview, then appearance (mobile order)', async () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    const settings = screen.getByRole('complementary', { name: 'QR Code Settings' });
    const preview = screen.getByRole('region', { name: 'QR Code Preview' });
    const content = within(settings).getByRole('heading', { name: 'Content' });
    const appearance = await screen.findByRole('heading', { name: 'Appearance' }, { timeout: 10000 });

    expect(content.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A mobile jump link keeps preview and download one tap away.
    expect(screen.getByRole('link', { name: 'Preview & download' })).toHaveAttribute('href', '#qr-preview');
  });

  it('renders how-to/FAQ outside the tool column at article width', () => {
    render(<ToastProvider><QRTool toolId="wifi-qr-code" /></ToastProvider>);
    const settings = screen.getByRole('complementary', { name: 'QR Code Settings' });
    const educational = document.getElementById('content-section');
    expect(educational).not.toBeNull();
    expect(settings).not.toContainElement(educational);
    expect(screen.getByRole('region', { name: 'QR Code Preview' })).not.toContainElement(educational);
    expect(educational?.parentElement).toHaveClass('max-w-3xl');
  });

  it('groups appearance into disclosure sections that expose state and keep their content mounted', async () => {
    render(<ToastProvider><QRTool /></ToastProvider>);
    const patterns = await screen.findByRole('button', { name: 'Pattern & Colors' }, { timeout: 10000 });
    const layout = screen.getByRole('button', { name: 'Layout & Border' });
    const logo = screen.getByRole('button', { name: 'Logo' });

    expect(patterns).toHaveAttribute('aria-expanded', 'true');
    expect(layout).toHaveAttribute('aria-expanded', 'false');
    expect(logo).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(layout);
    expect(layout).toHaveAttribute('aria-expanded', 'true');
    const headline = screen.getByRole('radio', { name: /Minimalist template/i });
    fireEvent.click(headline);
    const headlineInput = screen.getByLabelText('Template headline');
    fireEvent.change(headlineInput, { target: { value: 'Scan me' } });

    // Collapse and re-open: the same inputs are still there with their values.
    fireEvent.click(layout);
    expect(layout).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(layout.getAttribute('aria-controls') ?? '')).toHaveAttribute('hidden');
    fireEvent.click(layout);
    expect(screen.getByLabelText('Template headline')).toBe(headlineInput);
    expect(headlineInput).toHaveValue('Scan me');
  });

  it('keeps a logical heading hierarchy with a single h1', async () => {
    const { container } = render(<ToastProvider><QRTool toolId="wifi-qr-code" /></ToastProvider>);
    await screen.findByRole('button', { name: 'Pattern & Colors' }, { timeout: 10000 });
    const levels = headingLevels(container);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('server-renders the instructions and FAQ', () => {
    const html = renderToString(<PageCopyContext.Provider value={pageCopy('wifi-qr-code')}><ToastProvider><QRTool toolId="wifi-qr-code" /></ToastProvider></PageCopyContext.Provider>);
    const content = pageCopy('wifi-qr-code');
    expect(html).toContain('Frequently Asked Questions');
    expect(html).toContain(content.howTo?.name ?? 'How to');
    const faqs = content.faqs && content.faqs.length > 0 ? content.faqs : pageCopy('index').faqs ?? [];
    expect(faqs.length).toBeGreaterThan(0);
    expect(html).toContain(faqs[0].question.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
  });

  it('has one export row that steps aside on phones while a text field has focus', async () => {
    render(<ToastProvider><QRTool initialConfig={{ value: 'https://example.com' }} /></ToastProvider>);
    const row = screen.getByTestId('export-actions');
    expect(within(row).getAllByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ })).toHaveLength(1);
    expect(row).not.toHaveClass('max-md:hidden');

    const field = document.createElement('input');
    document.body.appendChild(field);
    act(() => field.focus());
    expect(row).toHaveClass('max-md:hidden');
    act(() => field.blur());
    expect(row).not.toHaveClass('max-md:hidden');
    field.remove();
  });
});
