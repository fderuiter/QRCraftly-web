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

// @vitest-environment jsdom
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import Page from './+Page';
import { ToastProvider } from '@/components/ui/Toast';
import { FountainReassembler, TRANSFER_DENSITY_PROFILES, createPrismSession } from '@/packages/optical-transfer';

/** A Prism stream for a text file, as a sender would show it. */
async function prismStream(content: string, fileName = 'note.txt', mimeType = 'text/plain') {
  const { errorCorrectionLevel, maxVersion } = TRANSFER_DENSITY_PROFILES.balanced;
  const { stream } = await createPrismSession(new TextEncoder().encode(content), { fileName, mimeType, errorCorrectionLevel, maxVersion });
  return stream;
}

let scanSuccessCallback: ((data: string) => void) | undefined;

vi.mock('@/packages/optical-scanner/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/optical-scanner/client')>();
  return {
    ...actual,
    useQrScanner: (options: Parameters<typeof actual.useQrScanner>[0]) => {
      const onScanSuccess = options?.onScanSuccess;
      scanSuccessCallback = onScanSuccess
        ? (data) => onScanSuccess(data, { text: data, bytes: null, corners: null, source: 'jsqr', durationMs: 0 })
        : undefined;
      return actual.useQrScanner(options);
    }
  };
});

describe('File Transfer Receive Page & Pipeline', () => {
  let originalMediaDevices: any;

  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'mock-download-url');
    global.URL.revokeObjectURL = vi.fn();
    // Mock HTMLMediaElement.prototype.play
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());

    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: originalMediaDevices,
    });
    vi.restoreAllMocks();
  });

  it('renders the file-transfer receive page with initial elements', () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    expect(screen.getByText('Receive a File by QR Code')).toBeInTheDocument();
    expect(screen.getByText('Ready to scan')).toBeInTheDocument();
    expect(screen.getByText('Start an animated QR file transfer from the sender.')).toBeInTheDocument();
    
    // Check buttons
    expect(screen.getByRole('button', { name: /activate camera scanner/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /simulate prism stream/i })).toBeInTheDocument();
  });

  it('does not expose simulation or security-testing controls in production', () => {
    vi.stubEnv('DEV', false);
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    expect(screen.queryByText('Simulation & Validation Testing')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate prism stream/i })).not.toBeInTheDocument();
  });

  it('can activate and deactivate the camera scanner', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    const activateButton = screen.getByRole('button', { name: /activate camera scanner/i });
    
    await act(async () => {
      fireEvent.click(activateButton);
    });

    // Scanner is active
    expect(screen.getByText('Active Scanning')).toBeInTheDocument();
    
    const deactivateButton = screen.getByRole('button', { name: /deactivate camera scanner/i });
    expect(deactivateButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(deactivateButton);
    });

    expect(screen.getByText('Camera is off')).toBeInTheDocument();
  });

  it('explains a blocked camera and offers the video file route', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /activate camera scanner/i }));
    });

    const alert = await screen.findByTestId('camera-error');
    expect(alert).toHaveTextContent(/Camera access was blocked/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use a video file instead' }));
    });
    expect(screen.getByRole('radio', { name: /^video file/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('camera-error')).not.toBeInTheDocument();
  });

  it('ignores codes that are not part of a transfer, whatever they say', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    for (const other of ["javascript:alert('x')", 'https://example.com', 'H|a.txt|10|text/plain|' + 'a'.repeat(64), 'F|0|2|Zm9v']) {
      await act(async () => {
        scanSuccessCallback!(other);
      });
    }

    expect(screen.getByText('Ready to scan')).toBeInTheDocument();
    expect(screen.queryByTestId('receiver-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manifest-info')).not.toBeInTheDocument();
  });

  describe('Rateless fountain reception', () => {
    /** Routes reassembly-worker frames through a real FountainReassembler. */
    function installFountainWorker() {
      const reassembler = new FountainReassembler();
      globalThis.mockWorkerControl.setInterceptor(async (message: any, worker: any) => {
        if (!String(worker.url).includes('worker-reassembly')) return;
        if (message.type === 'CLEAR') {
          reassembler.reset();
          return;
        }
        if (message.type !== 'FOUNTAIN_DROPLET') return;
        const snap = reassembler.ingest(message.droplet);
        const manifest = reassembler.takeManifest();
        if (manifest) worker.dispatchMessage({ type: 'MANIFEST', manifest });
        if (!snap) return;
        worker.dispatchMessage({ type: 'PROGRESS', progress: snap.progress, current: snap.resolved, total: snap.k, rank: snap.rank, dropletsReceived: snap.dropletsReceived, isFountain: true });
        if (!reassembler.isComplete) return;
        const {
          files: [{ data, header }],
        } = await reassembler.finalize();
        worker.dispatchMessage({ type: 'COMPLETE', buffer: data.slice().buffer, handshake: { fileName: header.fileName, fileSize: header.fileSize, mimeType: header.mimeType, sha256: header.sha256 }, isFountain: true });
      });
    }

    afterEach(() => {
      globalThis.mockWorkerControl.setInterceptor(null);
    });

    it('shows the file details from the manifest, then telemetry, and verifies SHA-256 before download', async () => {
      installFountainWorker();
      const text = 'Page-level fountain telemetry. '.repeat(40);
      const stream = await prismStream(text, 'fountain.txt');

      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // The first frame is the manifest: the file's name, size and type show before any data decodes.
      await act(async () => {
        scanSuccessCallback!(stream.frameText(0));
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      expect(screen.getByTestId('manifest-info')).toBeInTheDocument();
      expect(screen.getByTestId('manifest-name')).toHaveTextContent('fountain.txt');
      expect(screen.getByTestId('manifest-size')).toHaveTextContent('1.2 KB');
      expect(screen.getByTestId('manifest-type')).toHaveTextContent('text/plain');
      expect(screen.getByTestId('manifest-fingerprint')).toHaveTextContent(stream.fingerprint);
      expect(screen.queryByText('Ready to scan')).not.toBeInTheDocument();
      expect(screen.queryByTestId('fountain-telemetry')).not.toBeInTheDocument();

      // Join mid-stream: the next frame seen is #6.
      await act(async () => {
        scanSuccessCallback!(stream.frameText(5));
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(screen.getByTestId('fountain-telemetry')).toBeInTheDocument();
      expect(screen.getByTestId('fountain-droplets')).toHaveTextContent(/^1$/);
      // A repair symbol may not raise the rank on its own.
      expect(screen.getByTestId('fountain-rank')).toHaveTextContent(new RegExp(`^[01] / ${stream.k}$`));
      expect(screen.getByTestId('fountain-fps')).toHaveTextContent(/fps/);
      expect(screen.getByTestId('fountain-eta')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /blocks decoded/i })).toBeInTheDocument();
      expect(screen.queryByTestId('receiver-error')).not.toBeInTheDocument();

      for (let index = 6; index < stream.k * 6 + 40; index++) {
        if (index % 3 === 0) continue; // dropped frames
        await act(async () => {
          scanSuccessCallback!(stream.frameText(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        if (screen.queryByTestId('inline-complete-panel')) break;
      }

      await waitFor(() => expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument());
      expect(screen.getByText(/File arrived intact \(SHA-256 verified\)/)).toBeInTheDocument();
      const summary = screen.getByTestId('received-file-summary');
      expect(summary).toHaveTextContent('fountain.txt');
      expect(summary).toHaveTextContent("1.2 KB");
      expect(screen.getByTestId('fountain-rank')).toHaveTextContent(`${stream.k} / ${stream.k}`);
      expect(screen.queryByTestId('manifest-info')).not.toBeInTheDocument();
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();

      const downloadBtn = screen.getByRole('button', { name: /^save$/i });
      await act(async () => {
        fireEvent.click(downloadBtn);
      });
      await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
    });

    it('shows only a sanitised name for the announced file', async () => {
      installFountainWorker();
      const stream = await prismStream('x'.repeat(100), `report${String.fromCharCode(0x202e)}fdp.exe`, 'application/pdf');
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );
      await act(async () => {
        scanSuccessCallback!(stream.frameText(0));
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      expect(screen.getByTestId('manifest-name')).toHaveTextContent('reportfdp.exe');
      expect(screen.getByTestId('manifest-name').textContent).not.toContain(String.fromCharCode(0x202e));
    });

    async function receiveFile(fileName: string, mimeType: string) {
      installFountainWorker();
      const stream = await prismStream('Risky type check. '.repeat(30), fileName, mimeType);
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );
      for (let index = 0; index < stream.k * 6 + 40; index++) {
        await act(async () => {
          scanSuccessCallback!(stream.frameText(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        if (screen.queryByTestId('inline-complete-panel')) break;
      }
      await waitFor(() => expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument());
    }

    it.each([
      ['notes.txt', 'text/plain'],
      ['scan.pdf', 'application/pdf'],
      ['photo.jpg', 'image/jpeg'],
    ])('saves %s with a single click and no risk confirmation (#1155)', async (fileName, mimeType) => {
      await receiveFile(fileName, mimeType);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      expect(screen.queryByTestId('risky-file-confirmation')).not.toBeInTheDocument();
      await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
    });

    it.each([
      ['setup.exe', 'application/x-msdownload'],
      ['page.html', 'text/html'],
      ['invoice.pdf.exe', 'application/pdf'],
    ])('asks for a second click before saving %s (#1155)', async (fileName, mimeType) => {
      await receiveFile(fileName, mimeType);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      expect(screen.getByTestId('risky-file-confirmation')).toHaveTextContent('can run programs on your device');
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      });
      expect(screen.queryByTestId('risky-file-confirmation')).not.toBeInTheDocument();
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
      });
      await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
    });

    it('shows the full name and cleans hidden characters from it (#1155)', async () => {
      await receiveFile(`report${String.fromCharCode(0x202e)}fdp.exe`, 'application/pdf');
      expect(screen.getByTestId('received-file-name')).toHaveTextContent('reportfdp.exe');
      expect(screen.getByTestId('received-file-notices')).toHaveTextContent('file name was cleaned');
    });

    it('clears a completed transfer and scans again with Receive another file', async () => {
      installFountainWorker();
      const stream = await prismStream('first file '.repeat(30), 'first.txt');
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      for (let index = 0; index < stream.k * 6 + 40 && !screen.queryByTestId('inline-complete-panel'); index++) {
        await act(async () => {
          scanSuccessCallback!(stream.frameText(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      }
      await waitFor(() => expect(screen.getByTestId('received-file-summary')).toHaveTextContent('first.txt'));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Receive another file' }));
      });
      expect(screen.queryByTestId('inline-complete-panel')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /deactivate camera scanner/i })).toBeInTheDocument();
    });

    it('runs the development Prism simulation end-to-end', async () => {
      installFountainWorker();
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /simulate prism stream/i }));
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 1500));
      });
      await waitFor(() => expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument());
    });
  });

  describe('Dual-Mode Receiver Pill Switcher and Video Dropzone', () => {
    it('allows toggling between camera feed mode and video file mode via pill switcher', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // Camera mode is active by default
      const cameraRadio = screen.getByRole('radio', { name: /camera feed/i });
      const fileRadio = screen.getByRole('radio', { name: /^video file/i });

      expect(cameraRadio).toHaveAttribute('aria-checked', 'true');
      expect(fileRadio).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('button', { name: /activate camera scanner/i })).toBeInTheDocument();

      // Switch to Video File mode
      await act(async () => {
        fireEvent.click(fileRadio);
      });

      expect(fileRadio).toHaveAttribute('aria-checked', 'true');
      expect(cameraRadio).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByTestId('sidebar-dropzone')).toBeInTheDocument();
      expect(screen.getByTestId('viewport-dropzone')).toBeInTheDocument();

      // Switch back to Camera mode
      await act(async () => {
        fireEvent.click(cameraRadio);
      });

      expect(cameraRadio).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: /activate camera scanner/i })).toBeInTheDocument();
    });

    it('loads a valid video file when selected via file input and starts scanning', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      const fileRadio = screen.getByRole('radio', { name: /^video file/i });
      await act(async () => {
        fireEvent.click(fileRadio);
      });

      const fileInput = screen.getByTestId('video-file-input');
      const validFile = new File(['fake video'], 'transfer_recording.mp4', { type: 'video/mp4' });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [validFile] } });
      });

      expect(global.URL.createObjectURL).toHaveBeenCalledWith(validFile);
      expect(screen.getByText('transfer_recording.mp4')).toBeInTheDocument();
      expect(screen.getByText('Active Scanning')).toBeInTheDocument();
    });

    it('shows inline validation error alert when an unsupported file type is uploaded and blocks processing', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      const fileRadio = screen.getByRole('radio', { name: /^video file/i });
      await act(async () => {
        fireEvent.click(fileRadio);
      });

      const fileInput = screen.getByTestId('video-file-input');
      const invalidFile = new File(['text content'], 'notes.txt', { type: 'text/plain' });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [invalidFile] } });
      });

      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
      const errorAlert = screen.getByTestId('file-validation-error');
      expect(errorAlert).toBeInTheDocument();
      expect(errorAlert).toHaveTextContent('Invalid file type. Please upload a supported video file (e.g. MP4, WebM).');
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });

    it('revokes Object URLs when toggling mode back to camera mode', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      const cameraRadio = screen.getByRole('radio', { name: /camera feed/i });
      const fileRadio = screen.getByRole('radio', { name: /^video file/i });

      await act(async () => {
        fireEvent.click(fileRadio);
      });

      const fileInput = screen.getByTestId('video-file-input');
      const validFile = new File(['fake video'], 'transfer.mp4', { type: 'video/mp4' });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [validFile] } });
      });

      expect(global.URL.createObjectURL).toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(cameraRadio);
      });

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-download-url');
    });

    it('completes file transfer assembly when scanning frames from uploaded video file', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      const fileRadio = screen.getByRole('radio', { name: /^video file/i });
      await act(async () => {
        fireEvent.click(fileRadio);
      });

      const fileInput = screen.getByTestId('video-file-input');
      const validFile = new File(['fake video'], 'recording.webm', { type: 'video/webm' });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [validFile] } });
      });

      const stream = await prismStream('Recorded transfer. '.repeat(30), 'recorded.txt');
      for (let index = 0; index < stream.k * 6 + 40 && !screen.queryByTestId('inline-complete-panel'); index++) {
        await act(async () => {
          scanSuccessCallback!(stream.frameText(index));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }

      await waitFor(() => expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument());
      expect(screen.getByText('Transfer Complete')).toBeInTheDocument();
    });
  });
});
