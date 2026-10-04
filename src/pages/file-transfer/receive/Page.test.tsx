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
import { FountainReassembler, StreamLookaheadReceiver, createFountainSession } from '@/packages/optical-transfer';

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
    expect(screen.getByRole('button', { name: /simulate out-of-order/i })).toBeInTheDocument();
  });

  it('does not expose simulation or security-testing controls in production', () => {
    vi.stubEnv('DEV', false);
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    expect(screen.queryByText('Simulation & Validation Testing')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate out-of-order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate dangerous scheme/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate split threat/i })).not.toBeInTheDocument();
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

  it('simulates out-of-order packet reassembly and triggers offline download on complete', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    const simButton = screen.getByRole('button', { name: /simulate out-of-order/i });
    
    await act(async () => {
      fireEvent.click(simButton);
    });

    // Wait for setTimeouts inside simulation to execute
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    // Legacy streams show a plain progress readout; the per-part grid is gone.
    expect(screen.getByText('10 / 10 parts')).toBeInTheDocument();
    expect(screen.queryByTestId('progress-grid')).not.toBeInTheDocument();

    // Verify the inline complete panel replaced the active camera space
    expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument();
    expect(screen.getByText('Transfer Complete')).toBeInTheDocument();

    // Verify no download is automatically initiated before user confirmation
    expect(global.URL.createObjectURL).not.toHaveBeenCalled();

    // Click the Save button inside the complete panel
    const downloadBtn = screen.getByRole('button', { name: /^save$/i });
    expect(downloadBtn).toBeInTheDocument();
    
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    // Verify that createObjectURL is eventually called for client-side download reconstruction
    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  it('terminates session and triggers a security alert when restricted scheme (javascript:) is scanned', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    const simButton = screen.getByRole('button', { name: /simulate dangerous scheme/i });
    
    await act(async () => {
      fireEvent.click(simButton);
    });

    // Security alert is rendered
    expect(screen.getByText(/Security Intercepted/i)).toBeInTheDocument();
    expect(screen.getByText(/Dangerous protocol detected and blocked: javascript:/i)).toBeInTheDocument();
    
    // Scanner is inactive
    expect(screen.getByText('Camera is off')).toBeInTheDocument();
  });

  it('lookahead receiver intercepts and terminates a split protocol threat across frames', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    const simButton = screen.getByRole('button', { name: /simulate split threat/i });
    
    await act(async () => {
      fireEvent.click(simButton);
    });

    // Wait for the 100ms deferred frame
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    expect(screen.getByText(/Security Intercepted/i)).toBeInTheDocument();
    expect(screen.getByText(/MaliciousStreamError: Detected dangerous protocol prefix "javascript:" split across frames./i)).toBeInTheDocument();
    expect(screen.getByText('Camera is off')).toBeInTheDocument();
  });

  it('no longer offers a Compatibility mode toggle and always keeps text safety checks on', async () => {
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>
    );

    expect(screen.queryByRole('switch', { name: /compatibility mode/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Compatibility mode/i)).not.toBeInTheDocument();

    const simDangerousButton = screen.getByRole('button', { name: /simulate dangerous scheme/i });
    await act(async () => {
      fireEvent.click(simDangerousButton);
    });
    expect(screen.getByText(/Security Intercepted/i)).toBeInTheDocument();
  });

  describe('Synchronous Page-Level QR Frame Deduplication', () => {
    it('should track processed frame indices and synchronously discard duplicates before downstream lookahead', async () => {
      const receiveSpy = vi.spyOn(StreamLookaheadReceiver.prototype, 'receive');
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // Verify callback was captured
      expect(scanSuccessCallback).toBeDefined();

      // Scan initial handshake
      await act(async () => {
        scanSuccessCallback!("H|test.txt|100|text/plain|sha256");
      });

      // Scan unique frame index 0
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });

      expect(receiveSpy).toHaveBeenCalledTimes(1);
      expect(receiveSpy).toHaveBeenLastCalledWith("chunk0");

      // Scan duplicate frame index 0 - should be discarded synchronously
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });

      // StreamLookaheadReceiver.receive should NOT be called again
      expect(receiveSpy).toHaveBeenCalledTimes(1);

      // Scan a new unique frame index 1 - should be processed
      await act(async () => {
        scanSuccessCallback!("F|1|3|Y2h1bmsx");
      });

      expect(receiveSpy).toHaveBeenCalledTimes(2);
      expect(receiveSpy).toHaveBeenLastCalledWith("chunk1");
    });

    it('should clear the tracking cache when receiver state is reset', async () => {
      const receiveSpy = vi.spyOn(StreamLookaheadReceiver.prototype, 'receive');
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // Scan initial handshake
      await act(async () => {
        scanSuccessCallback!("H|test.txt|100|text/plain|sha256");
      });

      // Scan frame index 0
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });
      expect(receiveSpy).toHaveBeenCalledTimes(1);

      // Reset the receiver state
      const clearButton = screen.getByRole('button', { name: /clear transfer progress/i });
      await act(async () => {
        fireEvent.click(clearButton);
      });

      // Scan handshake again after reset
      await act(async () => {
        scanSuccessCallback!("H|test.txt|100|text/plain|sha256");
      });

      // Scan frame index 0 again - should be processed since cache was cleared
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });
      // It will be processed on a new StreamLookaheadReceiver instance
      expect(receiveSpy).toHaveBeenCalledTimes(2);
    });

    it('should clear the tracking cache when a new scanner session starts', async () => {
      const receiveSpy = vi.spyOn(StreamLookaheadReceiver.prototype, 'receive');
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // Scan initial handshake
      await act(async () => {
        scanSuccessCallback!("H|test.txt|100|text/plain|sha256");
      });

      // Scan frame index 0
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });
      expect(receiveSpy).toHaveBeenCalledTimes(1);

      // Click Activate to initialize state, then Deactivate
      const activateButton = screen.getByRole('button', { name: /activate camera scanner/i });
      await act(async () => {
        fireEvent.click(activateButton);
      });
      
      const deactivateButton = screen.getByRole('button', { name: /deactivate camera scanner/i });
      await act(async () => {
        fireEvent.click(deactivateButton);
      });

      // Click Activate Camera Scanner again to start a new session
      await act(async () => {
        fireEvent.click(activateButton);
      });

      // Scan initial handshake
      await act(async () => {
        scanSuccessCallback!("H|test.txt|100|text/plain|sha256");
      });

      // Scan frame index 0 again - should be processed because starting a new session resets tracking cache
      await act(async () => {
        scanSuccessCallback!("F|0|3|Y2h1bmsw");
      });
      expect(receiveSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Adaptive Progress Rendering and Validation for File Transfers', () => {
    it('rejects transfers with more than 5000 chunks and displays a user-friendly error message', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      expect(scanSuccessCallback).toBeDefined();

      await act(async () => {
        scanSuccessCallback!("F|0|5001|Zm9v");
      });

      // Verify error message is rendered
      const errorAlert = screen.getByTestId('receiver-error');
      expect(errorAlert).toBeInTheDocument();
      expect(errorAlert).toHaveTextContent('File transfer rejected: exceeds the maximum limit of 5000 chunks.');

      // Verify grid is not in the document
      expect(screen.queryByTestId('progress-grid')).not.toBeInTheDocument();
    });

    it('shows a progress readout without a per-part grid for legacy chunk streams', async () => {
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      expect(scanSuccessCallback).toBeDefined();

      await act(async () => {
        scanSuccessCallback!("H|test.txt|1000|text/plain|sha256");
      });

      await act(async () => {
        scanSuccessCallback!("F|0|150|Zm9v");
      });

      expect(screen.getByTestId('legacy-progress')).toBeInTheDocument();
      expect(screen.getByText('1 / 150 parts')).toBeInTheDocument();
      expect(screen.queryByTestId('progress-grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chunk-block-0')).not.toBeInTheDocument();
      expect(screen.queryByTestId('fallback-progress-card')).not.toBeInTheDocument();
    });
  });

  describe('Rateless fountain reception', () => {
    /** Routes reassembly-worker droplets through a real FountainReassembler. */
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
        if (!snap) return;
        worker.dispatchMessage({ type: 'PROGRESS', progress: snap.progress, current: snap.resolved, total: snap.k, rank: snap.rank, dropletsReceived: snap.dropletsReceived, isFountain: true });
        if (!reassembler.isComplete) return;
        const { data, header } = await reassembler.finalize();
        worker.dispatchMessage({ type: 'COMPLETE', buffer: data.slice().buffer, handshake: { fileName: header.fileName, fileSize: header.fileSize, mimeType: header.mimeType, sha256: header.sha256 }, isFountain: true });
      });
    }

    afterEach(() => {
      globalThis.mockWorkerControl.setInterceptor(null);
    });

    it('shows droplets/K, rank, FPS and ETA telemetry and verifies SHA-256 before download', async () => {
      installFountainWorker();
      const text = 'Page-level fountain telemetry. '.repeat(40);
      const { encoder } = await createFountainSession(new TextEncoder().encode(text), { fileName: 'fountain.txt', mimeType: 'text/plain' });

      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      // Join mid-stream: the first droplet seen is #6, no handshake frame ever arrives.
      await act(async () => {
        scanSuccessCallback!(encoder.dropletStringForIndex(5));
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(screen.getByTestId('fountain-telemetry')).toBeInTheDocument();
      expect(screen.getByTestId('fountain-droplets')).toHaveTextContent(/^1$/);
      // A repair droplet may not raise the rank on its own.
      expect(screen.getByTestId('fountain-rank')).toHaveTextContent(new RegExp(`^[01] / ${encoder.k}$`));
      expect(screen.getByTestId('fountain-fps')).toHaveTextContent(/fps/);
      expect(screen.getByTestId('fountain-eta')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /blocks decoded/i })).toBeInTheDocument();
      expect(screen.queryByTestId('progress-grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('receiver-error')).not.toBeInTheDocument();

      for (let index = 6; index < encoder.k * 4; index++) {
        if (index % 3 === 0) continue; // dropped frames
        await act(async () => {
          scanSuccessCallback!(encoder.dropletStringForIndex(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
        if (screen.queryByTestId('inline-complete-panel')) break;
      }

      await waitFor(() => expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument());
      expect(screen.getByText(/SHA-256 checksum matches the sender/)).toBeInTheDocument();
      const summary = screen.getByTestId('received-file-summary');
      expect(summary).toHaveTextContent('fountain.txt');
      expect(summary).toHaveTextContent("1.2 KB");
      expect(screen.getByTestId('fountain-rank')).toHaveTextContent(`${encoder.k} / ${encoder.k}`);
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();

      const downloadBtn = screen.getByRole('button', { name: /^save$/i });
      await act(async () => {
        fireEvent.click(downloadBtn);
      });
      await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
    });

    it('clears a completed transfer and scans again with Receive another file', async () => {
      installFountainWorker();
      const { encoder } = await createFountainSession(new TextEncoder().encode('first file '.repeat(30)), {
        fileName: 'first.txt',
        mimeType: 'text/plain',
      });
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      for (let index = 0; index < encoder.k * 4 && !screen.queryByTestId('inline-complete-panel'); index++) {
        await act(async () => {
          scanSuccessCallback!(encoder.dropletStringForIndex(index));
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

    it('runs the development fountain simulation end-to-end', async () => {
      installFountainWorker();
      render(
        <ToastProvider>
          <Page />
        </ToastProvider>
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /simulate fountain stream/i }));
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

      // Scan handshake first
      await act(async () => {
        scanSuccessCallback!('H|test.txt|100|text/plain|sha256');
      });

      // Scan frame 0 and frame 1
      await act(async () => {
        scanSuccessCallback!('F|0|2|Zm9v');
      });
      await act(async () => {
        scanSuccessCallback!('F|1|2|YmFy');
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(screen.getByTestId('inline-complete-panel')).toBeInTheDocument();
      expect(screen.getByText('Transfer Complete')).toBeInTheDocument();
    });
  });
});
