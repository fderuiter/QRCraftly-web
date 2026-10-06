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
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import Page from './+Page';
import type { ScannabilityResult } from '@/packages/scannability';

// The first-frame scannability gate runs on the main thread with a passing verdict, so the test
// does not depend on canvas pixels or the Scannability Worker.
const mainThreadVerdict = vi.hoisted(() => ({ success: true }));
vi.mock('@/packages/scannability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/scannability')>()),
  createScannabilityWorker: () => null,
}));
vi.mock('@/packages/scannability/checker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/scannability/checker')>()),
  performScannabilityCheck: (): ScannabilityResult => ({ success: mainThreadVerdict.success, physicalReady: mainThreadVerdict.success }),
}));

// Mock the crypto APIs if missing in test environment
const mockSubtle = {
  digest: async (algorithm: string, data: ArrayBuffer) => {
    // Return a mock SHA-256 hash value that is verified in tests
    return new Uint8Array([
      0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14,
      0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f, 0xb9, 0x24,
      0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c,
      0xa4, 0x95, 0x99, 0x1b, 0x78, 0x52, 0xb8, 0x55
    ]).buffer;
  }
};

Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: mockSubtle,
    getRandomValues: (arr: any) => arr,
  },
  configurable: true,
  writable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    value: {
      subtle: mockSubtle,
      getRandomValues: (arr: any) => arr,
    },
    configurable: true,
    writable: true,
  });
}

// Mock the continuous QR scanner component for easy integration testing
vi.mock('@/components/QRScanner', () => {
  return {
    QRScanner: ({ onScanSuccess }: any) => {
      return (
        <div data-testid="mock-qr-scanner">
          <span>Mock Camera Stream</span>
          <button
            data-testid="trigger-scan-handshake"
            onClick={() => onScanSuccess('H|test.txt|8|text/plain|e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')}
          >
            Scan Handshake
          </button>
          <button
            data-testid="trigger-scan-data-0"
            onClick={() => onScanSuccess('F|0|2|Zm9v')}
          >
            Scan Data 0
          </button>
          <button
            data-testid="trigger-scan-data-1"
            onClick={() => onScanSuccess('F|1|2|YmFy')}
          >
            Scan Data 1
          </button>
          <button
            data-testid="trigger-scan-corrupt-handshake"
            onClick={() => onScanSuccess('H|test.txt|8|text/plain|corruptedhash')}
          >
            Scan Corrupt Handshake
          </button>
        </div>
      );
    }
  };
});

describe('File Transfer Page & Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  it('renders the file-transfer page with options, headers and single canvas', () => {
    render(<Page />);

    expect(screen.getByText('Send a File by QR Code')).toBeInTheDocument();
    
    // One Speed control up front; the raw values wait under Advanced.
    const speed = screen.getByRole('radiogroup', { name: 'Speed' });
    expect(within(speed).getByRole('radio', { name: 'Balanced' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByLabelText('Transfer speed')).toBeInTheDocument();
    const density = screen.getByRole('radiogroup', { name: 'QR density' });
    expect(within(density).getByRole('radio', { name: 'Balanced' })).toHaveAttribute('aria-checked', 'true');

    // Canvas exists
    const canvas = screen.getByRole('img', { name: /transfer qr/i });
    expect(canvas).toBeInTheDocument();
  });

  it('offers wallet-compatible sending only for a transfer that is not private (#1149)', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const wallet = screen.getByRole('switch', { name: 'Wallet-compatible (BC-UR)' });
    expect(wallet).toBeEnabled();
    fireEvent.click(wallet);
    expect(wallet).toBeChecked();
    expect(screen.getByTestId('fountain-symbol-info')).toHaveTextContent(/fewer bytes per QR/);

    fireEvent.click(screen.getByRole('switch', { name: 'Private transfer' }));
    expect(wallet).toBeDisabled();
    expect(wallet).not.toBeChecked();
    expect(screen.getByTestId('wallet-bcur-hint')).toHaveTextContent(/no encryption/);
  });

  it('does not expose the high-load simulation control in production', () => {
    vi.stubEnv('DEV', false);
    render(<Page />);

    expect(screen.queryByRole('button', { name: /simulate 50mb/i })).not.toBeInTheDocument();
  });

  it('sets density and frame rate from the Speed control and shows the time for the chosen file', async () => {
    render(<Page />);
    const estimate = screen.getByTestId('speed-estimate');
    expect(estimate).toHaveTextContent('Choose a file to see how long it will take.');

    const file = new File([new Uint8Array(48 * 1024)], 'report.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose a file to send'), { target: { files: [file] } });
    });
    expect(estimate).toHaveTextContent(/^~\d+ (s|min) for this 48 KB file$/);

    const speed = screen.getByRole('radiogroup', { name: 'Speed' });
    await act(async () => {
      fireEvent.click(within(speed).getByRole('radio', { name: 'Fast' }));
    });
    expect(within(speed).getByRole('radio', { name: 'Fast' })).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('Transfer speed') as HTMLInputElement).value).toBe('24');

    // Setting the frame rate by hand leaves no preset selected and says so.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Transfer speed'), { target: { value: '19' } });
    });
    expect(within(speed).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(screen.getByText('Custom values set under Advanced.')).toBeInTheDocument();
  });

  it('shows the pairing guide once a file is chosen', async () => {
    render(<Page />);
    expect(screen.queryByTestId('pairing-guide')).not.toBeInTheDocument();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose a file to send'), { target: { files: [file] } });
    });
    expect(screen.getByTestId('pairing-guide')).toHaveTextContent('Point your other phone here');
  });

  it('allows adjusting stream swap rate (FPS) slider controls', async () => {
    render(<Page />);

    const fpsSlider = screen.getByLabelText('Transfer speed') as HTMLInputElement;
    expect(fpsSlider.value).toBe('15');

    await act(async () => {
      fireEvent.change(fpsSlider, { target: { value: '30' } });
    });

    expect(fpsSlider.value).toBe('30');
  });

  it('selects a file dropped onto the file drop zone', () => {
    render(<Page />);

    const file = new File(['payload'], 'dropped.txt', { type: 'text/plain' });
    const fileInput = screen.getByText('Choose files or drag & drop').closest('label');

    expect(fileInput).not.toBeNull();
    fireEvent.drop(fileInput!, { dataTransfer: { files: [file] } });

    expect(screen.getAllByText('dropped.txt')).toHaveLength(2);
  });

  it('simulates the 50MB high-load file and starts/stops transfer', async () => {
    mainThreadVerdict.success = true;
    render(<Page />);

    // Select the simulated file
    const simButton = screen.getByRole('button', { name: /simulate 50mb/i });
    await act(async () => {
      fireEvent.click(simButton);
    });

    // Verify stats exist
    expect(screen.getAllByText('simulation_50mb_payload.bin')[0]).toBeInTheDocument();
    expect(screen.getByText('50.00 MB')).toBeInTheDocument();

    // Set up worker interceptor to mock file transfer events
    const startTriggered = vi.fn();
    let interceptedWorker: any = null;

    globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
      interceptedWorker = worker;
      if (message.type === 'START') {
        startTriggered();
        
        // Mock worker sending first progress update
        worker.dispatchMessage({
          type: 'PROGRESS',
          index: 0,
          total: 1000
        });

        // Mock worker generating first frame matrix
        worker.dispatchMessage({
          type: 'FRAME',
          index: 0,
          total: 1000,
          size: 21,
          data: new Uint8Array(21 * 21) // 21x21 empty grid
        });
      }
    });

    // Start streaming
    const startStreamButton = screen.getByRole('button', { name: /start file transfer/i });
    await act(async () => {
      fireEvent.click(startStreamButton);
    });

    expect(startTriggered).toHaveBeenCalled();

    // Check progress is rendered after async handshake check completes
    await waitFor(() => {
      expect(screen.getByText('Frame buffer')).toBeInTheDocument();
    });

    // Stop streaming
    const stopStreamButton = screen.getByRole('button', { name: /stop file transfer/i });
    await act(async () => {
      fireEvent.click(stopStreamButton);
    });

    expect(screen.queryByText('Frame buffer')).not.toBeInTheDocument();
  });

  it('keeps playback paused and explains why when the first frame fails the scannability gate', async () => {
    mainThreadVerdict.success = false;
    try {
      render(<Page />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /simulate 50mb/i }));
      });
      globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
        if (message.type === 'START') {
          worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: 10 });
          worker.dispatchMessage({ type: 'FRAME', index: 0, total: 10, size: 21, data: new Uint8Array(21 * 21) });
        }
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start file transfer/i }));
      });

      expect(await screen.findByText(/failed scannability check/i)).toBeInTheDocument();
      expect(screen.queryByText('Frame buffer')).not.toBeInTheDocument();
    } finally {
      mainThreadVerdict.success = true;
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('locks every transfer setting from Start, while the first frame is still being checked', async () => {
    render(<Page />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /simulate 50mb/i }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    let start: any = null;
    // No frame arrives, so the page stays on "Checking QR…".
    globalThis.mockWorkerControl.setInterceptor((message: any) => {
      if (message.type === 'START') start = message;
    });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start file transfer/i }));
      });
      expect(screen.getByRole('button', { name: /start file transfer/i })).toHaveTextContent('Checking QR…');

      const privateSwitch = screen.getByRole('switch', { name: 'Private transfer' });
      for (const name of ['Private transfer', 'Wallet-compatible (BC-UR)', 'New transfer format (preview)', 'Several codes per frame (preview)']) {
        expect(screen.getByRole('switch', { name })).toBeDisabled();
      }
      expect(screen.getByLabelText('Choose a file to send')).toBeDisabled();
      for (const group of ['Speed', 'QR density']) {
        for (const radio of within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio')) expect(radio).toBeDisabled();
      }

      fireEvent.click(privateSwitch);
      expect(privateSwitch).not.toBeChecked();
      expect(start.payload.private).toBe(false);
    } finally {
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('keeps a private transfer\'s key words hidden until their button is held', async () => {
    render(<Page />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /simulate 50mb/i }));
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Private transfer' }));
    const keyCode = 'able baker charlie delta echo foxtrot golf hotel';
    globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
      if (message.type !== 'START') return;
      expect(message.payload.private).toBe(true);
      worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: 10 });
      worker.dispatchMessage({
        type: 'INITIALIZED',
        totalFrames: 10,
        sha256: '',
        fountain: { k: 10, symbolSize: 100, compression: 'none', density: 'balanced', fingerprint: 'abcd efgh ijkl mnop', fileCount: 1, keyCode, outerCode: 'lt', tiles: null, beacon: null, sessionId: '00', steerable: false },
      });
      worker.dispatchMessage({ type: 'FRAME', index: 0, total: 10, size: 21, data: new Uint8Array(21 * 21) });
    });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /start file transfer/i }));
      });
      const panel = await screen.findByTestId('sender-key-panel');
      expect(within(panel).queryByText(keyCode)).not.toBeInTheDocument();
      expect(within(panel).getByTestId('sender-key-code-hidden')).toBeInTheDocument();

      const hold = within(panel).getByRole('button', { name: 'Hold to show key code' });
      fireEvent.pointerDown(hold);
      expect(within(panel).getByTestId('sender-key-code')).toHaveTextContent(keyCode);
      fireEvent.pointerUp(hold);
      expect(within(panel).queryByText(keyCode)).not.toBeInTheDocument();

      fireEvent.keyDown(hold, { key: 'Enter' });
      expect(within(panel).getByTestId('sender-key-code')).toHaveTextContent(keyCode);
      fireEvent.blur(hold);
      expect(within(panel).queryByText(keyCode)).not.toBeInTheDocument();
    } finally {
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('unconditionally clears the file input value on change to allow consecutive re-selections of the same file', async () => {
    render(<Page />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(['consecutive payload'], 'same_file.txt', { type: 'text/plain' });

    // First selection
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Input value should be cleared synchronously to empty string
    expect(fileInput.value).toBe('');

    // Second consecutive selection of the exact same file
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(fileInput.value).toBe('');
    expect(screen.getAllByText('same_file.txt')[0]).toBeInTheDocument();
  });

  it('estimates the transfer time from the file size and the chosen QR density', async () => {
    render(<Page />);

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const info = screen.getByTestId('fountain-symbol-info');
    expect(info).toHaveTextContent('Choose a file to see how long the transfer will take.');

    const file = new File([new Uint8Array(20 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Choose a file to send'), { target: { files: [file] } });
    });

    const bytesPerQr = () => Number(/\((\d+) bytes per QR\)/.exec(info.textContent ?? '')?.[1]);
    expect(info).toHaveTextContent(/Estimated transfer time: up to/);
    const balanced = bytesPerQr();

    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'QR density' })).getByRole('radio', { name: 'Reliable' }));
    });
    expect(within(screen.getByRole('radiogroup', { name: 'QR density' })).getByRole('radio', { name: 'Reliable' })).toHaveAttribute('aria-checked', 'true');
    expect(bytesPerQr()).toBeLessThan(balanced);

    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: 'QR density' })).getByRole('radio', { name: 'Fast' }));
    });
    expect(bytesPerQr()).toBeGreaterThan(balanced);
  });

  it('clears file input value on drag-and-drop so subsequent manual picker selection works', async () => {
    render(<Page />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dropZone = screen.getByText('Choose files or drag & drop').closest('label');

    expect(fileInput).not.toBeNull();
    expect(dropZone).not.toBeNull();

    // Manually set input value to simulate lingering input state before drop
    Object.defineProperty(fileInput, 'value', { writable: true, value: 'C:\\fakepath\\old_file.txt' });
    expect(fileInput.value).toBe('C:\\fakepath\\old_file.txt');

    // Drag and drop a new file
    const droppedFile = new File(['dropped payload'], 'dropped_file.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.drop(dropZone!, { dataTransfer: { files: [droppedFile] } });
    });

    // File input value should be cleared synchronously
    expect(fileInput.value).toBe('');
  });
});
