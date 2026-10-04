// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QRScanner, clearScanHistory } from './QRScanner';
import { useQrScanner, type UseQrScannerOptions } from '@/packages/optical-scanner/client';
import jsQR from 'jsqr';
import { axe } from 'vitest-axe';

// The real hook and Camera Session run against a fake camera; the spy only records the options
// so a test can deliver a decoded code.
vi.mock('@/packages/optical-scanner/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/optical-scanner/client')>();
  return { ...actual, useQrScanner: vi.fn(actual.useQrScanner) };
});

vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

/** A camera track that records whether it was stopped. */
interface FakeTrack {
  readyState: 'live' | 'ended';
  stop: () => void;
}

describe('QRScanner Component', () => {
  const mockOnScanSuccess = vi.fn();
  let originalImage: typeof Image;
  let originalMediaDevices: MediaDevices | undefined;
  let tracks: FakeTrack[];
  let getUserMedia: ReturnType<typeof vi.fn<(constraints?: MediaStreamConstraints) => Promise<MediaStream>>>;

  /** Each successful request opens one new live track. */
  const openTrack = async (): Promise<MediaStream> => {
    const track: FakeTrack = {
      readyState: 'live',
      stop: () => {
        track.readyState = 'ended';
      },
    };
    tracks.push(track);
    const stream: Pick<MediaStream, 'getTracks'> = { getTracks: () => [track as unknown as MediaStreamTrack] };
    return stream as MediaStream;
  };
  const liveTracks = () => tracks.filter((track) => track.readyState === 'live').length;
  const deny = (name: string) => getUserMedia.mockRejectedValue(new DOMException('Camera refused', name));

  /** Delivers a decoded code the way the scanner engine does. */
  const decode = async (data: string) => {
    const options: UseQrScannerOptions | undefined = vi.mocked(useQrScanner).mock.lastCall?.[0];
    await act(async () => {
      options?.onScanSuccess?.(data, { text: data, bytes: null, corners: null, source: 'jsqr', durationMs: 0 });
    });
  };

  /** Lets pending camera requests settle. */
  const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    clearScanHistory();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
    originalImage = global.Image;
    global.Image = class {
      onload: any = null;
      onerror: any = null;
      _src: string = '';
      width = 100;
      height = 100;
      set src(val: string) {
        this._src = val;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
      get src() {
        return this._src;
      }
    } as any;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(4),
        width: 100,
        height: 100,
      }),
    } as any);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

    tracks = [];
    getUserMedia = vi.fn(openTrack);
    originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
  });

  afterEach(() => {
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
    global.Image = originalImage;
    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true, writable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders webcam view by default and opens the rear camera', async () => {
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    expect(screen.getByRole('radio', { name: 'Camera' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'false');
    await settle();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    expect(liveTracks()).toBe(1);
  });

  it('exposes the selected input mode with aria-checked when switching to file upload', async () => {
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
    expect(screen.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Camera' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radiogroup', { name: 'Scanner input' })).toBeInTheDocument();
    // The file input is not nested inside the dropzone button.
    const input = screen.getByLabelText('Upload QR code image file');
    expect(input.closest('button')).toBeNull();
  });

  it('keeps the video mounted while camera permission is pending, then shows the stream', async () => {
    let grant: () => void = () => {};
    getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((resolve) => {
        grant = () => resolve(openTrack());
      })
    );

    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
    const video = screen.getByLabelText('Webcam feed') as HTMLVideoElement;
    expect(await screen.findByText('Starting the camera...')).toBeInTheDocument();

    await act(async () => {
      grant();
    });
    await settle();

    expect(screen.getByLabelText('Webcam feed')).toBe(video);
    expect(screen.queryByText('Starting the camera...')).not.toBeInTheDocument();
    expect(video.srcObject).not.toBeNull();
    expect(liveTracks()).toBe(1);
  });

  describe('one owner for the camera (#1097)', () => {
    it('opens exactly one camera under StrictMode and none after unmount', async () => {
      const { unmount } = render(
        <React.StrictMode>
          <QRScanner onScanSuccess={mockOnScanSuccess} />
        </React.StrictMode>
      );
      await settle();
      expect(liveTracks()).toBe(1);
      expect((screen.getByLabelText('Webcam feed') as HTMLVideoElement).srcObject).not.toBeNull();

      unmount();
      await settle();
      expect(liveTracks()).toBe(0);
    });

    it('leaves no camera running after 20 quick mount and unmount cycles', async () => {
      for (let i = 0; i < 20; i++) {
        const { unmount } = render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
        // Every other cycle unmounts before the browser answers the camera request.
        if (i % 2 === 0) await settle();
        unmount();
      }
      await settle();
      expect(tracks.length).toBeGreaterThanOrEqual(10);
      expect(liveTracks()).toBe(0);
    });

    it('does not ask for the camera again on a re-render', async () => {
      const { rerender } = render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      rerender(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(liveTracks()).toBe(1);
    });

    it('releases the camera when a result shows and reopens it from Scan another', async () => {
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      expect(liveTracks()).toBe(1);

      await decode('https://example.com/qr1');
      expect(mockOnScanSuccess).toHaveBeenCalledWith('https://example.com/qr1');
      expect(liveTracks()).toBe(0);
      expect(screen.getByRole('heading', { name: 'QR code found' })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Scan another' }));
      });
      await settle();
      expect(liveTracks()).toBe(1);
      expect((screen.getByLabelText('Webcam feed') as HTMLVideoElement).srcObject).not.toBeNull();
    });

    it('releases the camera when switching to file upload', async () => {
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      expect(liveTracks()).toBe(1);

      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
      });
      expect(liveTracks()).toBe(0);
    });
  });

  it('leads with the image fallback when camera permission is denied, and retries', async () => {
    deny('NotAllowedError');
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    expect(await screen.findByText('Camera Access Denied')).toBeInTheDocument();
    // Troubleshooting card should have specific instructions
    expect(screen.getByText(/Open iOS Settings|Open Android Settings|Open macOS System Settings|Open Windows Settings|Click the padlock/)).toBeInTheDocument();

    // The image fallback leads (#1055): it is the first action, before the permission help.
    const switchBtn = screen.getByRole('button', { name: 'Scan from an image instead' });
    const retry = screen.getByRole('button', { name: /retry permission/i });
    expect(switchBtn.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await axe(switchBtn.closest('div.absolute') as HTMLElement)).toHaveNoViolations();

    // Granting on retry replaces the card with the camera.
    getUserMedia.mockImplementation(openTrack);
    await act(async () => {
      fireEvent.click(retry);
    });
    await settle();
    expect(screen.queryByText('Camera Access Denied')).not.toBeInTheDocument();
    expect(liveTracks()).toBe(1);
  });

  it('switches to file upload from the denied card', async () => {
    deny('NotAllowedError');
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan from an image instead' }));
    expect(screen.getByRole('heading', { name: 'Scan from an image' })).toBeInTheDocument();
  });

  it('explains a missing camera without offering a permission retry', async () => {
    deny('NotFoundError');
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    expect(await screen.findByText('No Camera Found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan from an image instead' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry permission/i })).not.toBeInTheDocument();
  });

  it('explains a browser without a camera API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    expect(await screen.findByText('No Camera Found')).toBeInTheDocument();
  });

  it('explains a camera in use by another app and retries it (#1100)', async () => {
    deny('NotReadableError');
    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    expect(await screen.findByText('Camera In Use')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry permission/i })).not.toBeInTheDocument();
    getUserMedia.mockImplementation(openTrack);
    fireEvent.click(screen.getByRole('button', { name: 'Try the camera again' }));
    await settle();
    expect(screen.queryByText('Camera In Use')).not.toBeInTheDocument();
    expect(liveTracks()).toBe(1);
  });

  describe('camera controls (#1100)', () => {
    /** Opens a camera that reports the given Image Capture capabilities and settings. */
    const capableCamera = (capabilities: Record<string, unknown>, settings: Record<string, unknown> = {}) => {
      const applied: Array<Record<string, unknown>> = [];
      getUserMedia.mockImplementation(async () => {
        const stream = await openTrack();
        const [track] = stream.getTracks();
        Object.assign(track, {
          getCapabilities: () => capabilities,
          getSettings: () => settings,
          applyConstraints: async ({ advanced }: { advanced: Array<Record<string, unknown>> }) => {
            applied.push(...advanced);
            Object.assign(settings, ...advanced);
          },
        });
        return stream;
      });
      return applied;
    };
    const withCameras = (labels: string[]) => {
      const devices = labels.map((label, index) => ({ kind: 'videoinput', deviceId: `cam-${index}`, label }));
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia, enumerateDevices: async () => devices },
        configurable: true,
        writable: true,
      });
    };

    it('shows no controls for a camera without torch, zoom or a second camera', async () => {
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      expect(screen.queryByRole('button', { name: /torch/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('slider', { name: 'Zoom' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
    });

    it('offers the torch and zoom only when the camera supports them, accessibly', async () => {
      const applied = capableCamera({ torch: true, zoom: { min: 1, max: 4, step: 0.5 } }, { zoom: 1, deviceId: 'cam-0' });
      withCameras(['Back Camera', 'Front Camera']);
      const { container } = render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      await settle();

      const torch = await screen.findByRole('button', { name: /torch/i });
      expect(torch).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(torch);
      await settle();
      expect(applied).toContainEqual({ torch: true });
      expect(screen.getByRole('button', { name: /torch/i })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2.5' } });
      await settle();
      expect(applied).toContainEqual({ zoom: 2.5 });

      expect(screen.getByLabelText('Camera')).toHaveValue('cam-0');
      expect(await axe(container)).toHaveNoViolations();
    });

    it('switches cameras without leaving the old one running', async () => {
      capableCamera({}, { deviceId: 'cam-0' });
      withCameras(['Back Camera', 'Front Camera']);
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      await settle();

      fireEvent.change(await screen.findByLabelText('Camera'), { target: { value: 'cam-1' } });
      await settle();
      expect(getUserMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ video: expect.objectContaining({ deviceId: { exact: 'cam-1' } }) })
      );
      expect(liveTracks()).toBe(1);
      expect(tracks).toHaveLength(2);
    });

    it('mirrors the preview of a user-facing camera only', async () => {
      capableCamera({}, { facingMode: 'user' });
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      expect(screen.getByLabelText('Webcam feed')).toHaveClass('-scale-x-100');
    });
  });

  it('allows switching to file upload mode via the tab and processes images', async () => {
    // Intercept scanner worker and mock successful response
    globalThis.mockWorkerControl.setInterceptor((msg, worker) => {
      setTimeout(() => {
        worker.dispatchMessage({
          status: 'pass',
          sequenceId: msg.sequenceId,
          decodedData: 'https://qrcraftly.com',
          buffer: msg.buffer || new ArrayBuffer(0),
        });
      }, 0);
    });

    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    const fileTab = screen.getByRole('radio', { name: 'Image' });
    fireEvent.click(fileTab);

    expect(screen.getByRole('heading', { name: 'Scan from an image' })).toBeInTheDocument();

    // Mock successful jsQR decoding
    vi.mocked(jsQR).mockReturnValue({ data: 'https://qrcraftly.com' } as any);

    // Mock FileReader and Image loading
    const mockFile = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const fileInput = screen.getByLabelText(/upload qr code image file/i);

    // Trigger file change
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(mockOnScanSuccess).toHaveBeenCalledWith('https://qrcraftly.com');
    });
  });

  it('handles image decoding failures cleanly and displays an error message', async () => {
    // Intercept scanner worker and mock fail response
    globalThis.mockWorkerControl.setInterceptor((msg, worker) => {
      setTimeout(() => {
        worker.dispatchMessage({
          status: 'fail',
          sequenceId: msg.sequenceId,
          buffer: msg.buffer || new ArrayBuffer(0),
        });
      }, 0);
    });

    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    const fileTab = screen.getByRole('radio', { name: 'Image' });
    fireEvent.click(fileTab);

    // Mock jsQR returning null (no QR code found)
    vi.mocked(jsQR).mockReturnValue(null);

    const mockFile = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const fileInput = screen.getByLabelText(/upload qr code image file/i);

    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByText(/no qr code detected in this image/i)).toBeInTheDocument();
    });
  });

  it('resets the file input value immediately, allows consecutive uploads of the same file, displays spinner, and updates error states', async () => {
    // Set up a worker interceptor to sequentially simulate successful, failed, and successful uploads
    let uploadIndex = 0;
    globalThis.mockWorkerControl.setInterceptor((msg, worker) => {
      setTimeout(() => {
        // One worker request per uploaded file.
        uploadIndex++;
        if (uploadIndex === 1) {
          worker.dispatchMessage({
            status: 'pass',
            sequenceId: msg.sequenceId,
            decodedData: 'scan 1',
            buffer: msg.buffer || new ArrayBuffer(0),
          });
        } else if (uploadIndex === 2) {
          worker.dispatchMessage({
            status: 'fail',
            sequenceId: msg.sequenceId,
            buffer: msg.buffer || new ArrayBuffer(0),
          });
        } else {
          worker.dispatchMessage({
            status: 'pass',
            sequenceId: msg.sequenceId,
            decodedData: 'scan 2',
            buffer: msg.buffer || new ArrayBuffer(0),
          });
        }
      }, 0);
    });

    render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

    const fileTab = screen.getByRole('radio', { name: 'Image' });
    fireEvent.click(fileTab);

    // Mock first upload as successful, second as failure, and third as success
    let callCount = 0;
    vi.mocked(jsQR).mockImplementation((data, width, height, options) => {
      if (!options || options.inversionAttempts === 'dontInvert') {
        callCount++;
      }
      if (callCount === 1) return { data: 'scan 1' } as any;
      if (callCount === 2 || callCount === 3) return null;
      return { data: 'scan 2' } as any;
    });

    const mockFile = new File(['dummy content'], 'test.png', { type: 'image/png' });
    let fileInput = screen.getByLabelText(/upload qr code image file/i) as HTMLInputElement;

    // First upload
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // 1. Selecting any file immediately resets the native value of the hidden file input element.
    expect(fileInput.value).toBe('');

    // Ensure the processing loader spinner is visible initially
    expect(screen.getByText(/processing file\.\.\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnScanSuccess).toHaveBeenCalledWith('scan 1');
    });
    // The result sheet replaces the image input until "Scan another".
    fireEvent.click(screen.getByRole('button', { name: 'Scan another' }));
    fileInput = screen.getByLabelText(/upload qr code image file/i) as HTMLInputElement;

    // Second consecutive upload of the exact same file
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    // 2. Clear native value immediately again
    expect(fileInput.value).toBe('');

    // 3. The loading state spinner appears on the second consecutive upload of the same file.
    expect(screen.getByText(/processing file\.\.\./i)).toBeInTheDocument();

    // 4. The error notification container updates correctly if the second upload fails again.
    await waitFor(() => {
      expect(screen.getByText(/no qr code detected in this image/i)).toBeInTheDocument();
    });

    // Third consecutive upload of the exact same file
    fireEvent.change(fileInput, { target: { files: [mockFile] } });
    expect(fileInput.value).toBe('');
    expect(screen.getByText(/processing file\.\.\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnScanSuccess).toHaveBeenCalledWith('scan 2');
    });

    // Reset jsQR mock implementation
    vi.mocked(jsQR).mockReset();
  });

  describe('image files only (#1098)', () => {
    it('accepts images only and turns away a dropped video', async () => {
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Image' }));

      expect(screen.getByLabelText('Upload QR code image file')).toHaveAttribute('accept', 'image/*');
      const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
      fireEvent.drop(screen.getByRole('heading', { name: 'Scan from an image' }), { dataTransfer: { files: [video] } });

      expect(screen.getByText('Please drop an image file.')).toBeInTheDocument();
      expect(screen.queryByText(/processing file/i)).not.toBeInTheDocument();
      expect(mockOnScanSuccess).not.toHaveBeenCalled();
    });

    it('lets a second file replace the first without an error', async () => {
      const answered: string[] = [];
      globalThis.mockWorkerControl.setInterceptor((msg, worker) => {
        // The first file takes longer than the second. A file cancelled before it was posted is
        // never sent at all.
        const name = msg.file?.name === 'a.png' ? 'first' : 'second';
        setTimeout(() => {
          answered.push(name);
          worker.dispatchMessage({ status: 'pass', sequenceId: msg.sequenceId, decodedData: name });
        }, name === 'first' ? 60 : 10);
      });

      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
      const fileInput = screen.getByLabelText('Upload QR code image file');

      fireEvent.change(fileInput, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } });
      fireEvent.change(fileInput, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } });

      await waitFor(() => expect(answered).toContain('second'));
      // Give a first answer, if the first file was posted, time to arrive and be ignored.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(mockOnScanSuccess).toHaveBeenCalledTimes(1);
      expect(mockOnScanSuccess).toHaveBeenCalledWith('second');
      expect(screen.queryByText(/already being processed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/processing file/i)).not.toBeInTheDocument();
    });
  });

  describe('file scanning around the camera', () => {
    it('allows file-upload component to mount and process files after scanner unmounts', async () => {
      globalThis.mockWorkerControl.setInterceptor((msg: any, worker: any) => {
        setTimeout(() => {
          worker.dispatchMessage({
            status: 'pass',
            sequenceId: msg.sequenceId,
            decodedData: 'https://post-unmount-scan.com',
            buffer: msg.buffer || new ArrayBuffer(0),
          });
        }, 0);
      });

      // 1. Mount and unmount QRScanner
      const { unmount } = render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await act(async () => {
        unmount();
      });

      // 2. Mount QRScanner in file mode and verify file processing works
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      const fileTab = screen.getByRole('radio', { name: 'Image' });
      fireEvent.click(fileTab);

      vi.mocked(jsQR).mockReturnValue({ data: 'https://post-unmount-scan.com' } as any);
      const mockFile = new File(['dummy content'], 'test.png', { type: 'image/png' });
      const fileInput = screen.getByLabelText(/upload qr code image file/i);

      fireEvent.change(fileInput, { target: { files: [mockFile] } });

      await waitFor(() => {
        expect(mockOnScanSuccess).toHaveBeenCalledWith('https://post-unmount-scan.com');
      });
    });

    it('immediately aborts active file processing when switching modes from file to webcam', async () => {
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);

      const fileTab = screen.getByRole('radio', { name: 'Image' });
      fireEvent.click(fileTab);

      vi.mocked(jsQR).mockReturnValue({ data: 'stale result' } as any);

      const mockFile = new File(['dummy file'], 'test.png', { type: 'image/png' });
      const fileInput = screen.getByLabelText(/upload qr code image file/i);

      fireEvent.change(fileInput, { target: { files: [mockFile] } });

      // Switch to webcam mode mid-processing
      const webcamTab = screen.getByRole('radio', { name: 'Camera' });
      fireEvent.click(webcamTab);

      // Give the abandoned scan time to finish (it would land well within this), then verify the
      // scan success callback was not invoked with the stale result.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnScanSuccess).not.toHaveBeenCalledWith('stale result');
    });
  });

  describe('result sheet, image input and announcements (#1101, #1102)', () => {
    /** Makes the next image scans decode to `data`. */
    const decodeImagesAs = (data: string) => {
      globalThis.mockWorkerControl.setInterceptor((msg, worker) => {
        setTimeout(() => {
          worker.dispatchMessage({ status: 'pass', sequenceId: msg.sequenceId, decodedData: data, buffer: msg.buffer || new ArrayBuffer(0) });
        }, 0);
      });
      vi.mocked(jsQR).mockReturnValue({ data } as any);
    };

    it('shows a link host, a safety verdict and the actions, and announces the result', async () => {
      const onEdit = vi.fn();
      const { container } = render(<QRScanner onEdit={onEdit} />);
      await settle();
      await decode('https://example.com/menu');

      expect(screen.getByTestId('scan-result-host')).toHaveTextContent('example.com');
      expect(screen.getByText(/No warning signs found in the address/)).toBeInTheDocument();
      const open = screen.getByRole('link', { name: 'Open link' });
      expect(open).toHaveAttribute('href', 'https://example.com/menu');
      expect(open).toHaveAttribute('target', '_blank');
      expect(open).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      expect(screen.getAllByRole('status').some((node) => node.textContent === 'QR code found: URL, example.com')).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'QR code found' }));

      fireEvent.click(screen.getByRole('button', { name: 'Edit in generator' }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ text: 'https://example.com/menu' }));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('blocks a javascript: payload and offers Copy only', async () => {
      const { container } = render(<QRScanner onEdit={vi.fn()} />);
      await settle();
      await decode('javascript:alert(1)');

      expect(screen.getByRole('heading', { name: 'Blocked QR code' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/script or data address/);
      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Open link' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit in generator' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('reveals a lookalike host and warns about an unencrypted link', async () => {
      render(<QRScanner />);
      await settle();
      await decode('http://xn--pple-43d.com/login');

      expect(screen.getByTestId('scan-result-host')).toHaveTextContent('аpple.com');
      expect(screen.getByText(/mixes letters from different alphabets/)).toBeInTheDocument();
      expect(screen.getByText(/not encrypted/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit in generator' })).not.toBeInTheDocument();
    });

    it('lists cautions and notes for a disguised link, never calling it safe', async () => {
      const { container } = render(<QRScanner />);
      await settle();
      await decode('https://paypal.com@bit.ly:8443/x');

      expect(screen.getByRole('list', { name: 'Cautions' })).toHaveTextContent(/Everything before the @/);
      expect(screen.getByRole('list', { name: 'Notes' })).toHaveTextContent(/shortened link/);
      expect(screen.queryByText(/No warning signs/)).not.toBeInTheDocument();
      expect(screen.getByTestId('scan-result').textContent?.toLowerCase()).not.toMatch(/\bsafe\b/);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('summarises a WiFi code and copies its text', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<QRScanner />);
      await settle();
      await decode('WIFI:T:WPA;S:Cafe guest;P:secret;;');

      expect(screen.getByText('Network').nextSibling).toHaveTextContent('Cafe guest');
      expect(screen.getByText('WPA/WPA2/WPA3')).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      });
      expect(writeText).toHaveBeenCalledWith('WIFI:T:WPA;S:Cafe guest;P:secret;;');
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('keeps recent results for this tab and reopens them', async () => {
      const { unmount } = render(<QRScanner />);
      await settle();
      await decode('https://example.com/one');
      unmount();

      render(<QRScanner />);
      await settle();
      expect(screen.getByText('Recent scans in this tab (1)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'URL, example.com' }));
      expect(screen.getByTestId('scan-result-host')).toHaveTextContent('example.com');
    });

    it('locks onto the code corners and freezes the frame before the result opens', async () => {
      render(<QRScanner />);
      await settle();
      const options: UseQrScannerOptions | undefined = vi.mocked(useQrScanner).mock.lastCall?.[0];
      const corners = [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ] as const;
      await act(async () => {
        options?.onScanSuccess?.('LOCKED', { text: 'LOCKED', bytes: null, corners: [...corners], source: 'native', durationMs: 0 });
      });
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'QR code found' })).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'QR code found' })).toBeInTheDocument();
    });

    it('waits for a click before asking for the camera when auto start is off', async () => {
      render(<QRScanner autoStartCamera={false} />);
      await settle();
      expect(getUserMedia).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      });
      await settle();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('scans a pasted screenshot', async () => {
      decodeImagesAs('PASTED');
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      const image = new File(['png'], 'screenshot.png', { type: 'image/png' });
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { files: [image] } });
      await act(async () => {
        document.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => expect(mockOnScanSuccess).toHaveBeenCalledWith('PASTED'));
      expect(liveTracks()).toBe(0);
    });

    it('reads an image from the clipboard button', async () => {
      decodeImagesAs('CLIPBOARD');
      const blob = new Blob(['png'], { type: 'image/png' });
      const read = vi.fn().mockResolvedValue([{ types: ['image/png'], getType: vi.fn().mockResolvedValue(blob) }]);
      Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Paste image' }));
      });
      await waitFor(() => expect(mockOnScanSuccess).toHaveBeenCalledWith('CLIPBOARD'));
    });

    it('explains an empty clipboard as an alert', async () => {
      const read = vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]);
      Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });
      render(<QRScanner />);
      fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Paste image' }));
      });
      expect(screen.getByRole('alert')).toHaveTextContent('The clipboard has no image');
    });

    it('accepts an image dropped anywhere on the scanner, even over the camera', async () => {
      decodeImagesAs('DROPPED');
      render(<QRScanner onScanSuccess={mockOnScanSuccess} />);
      await settle();
      const image = new File(['png'], 'code.png', { type: 'image/png' });
      const scanner = screen.getByTestId('qr-scanner');
      fireEvent.dragOver(scanner, { dataTransfer: { files: [image], types: ['Files'] } });
      expect(screen.getByText('Drop the image to scan it')).toBeInTheDocument();
      await act(async () => {
        fireEvent.drop(scanner, { dataTransfer: { files: [image], types: ['Files'] } });
      });
      await waitFor(() => expect(mockOnScanSuccess).toHaveBeenCalledWith('DROPPED'));
    });

    it('keeps the image error outside the Choose image button and links it, with no axe violations', async () => {
      const { container } = render(<QRScanner />);
      fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
      expect(await axe(container)).toHaveNoViolations();

      const video = new File(['mp4'], 'clip.mp4', { type: 'video/mp4' });
      fireEvent.drop(screen.getByTestId('qr-scanner'), { dataTransfer: { files: [video] } });
      const error = screen.getByRole('alert');
      expect(error).toHaveTextContent('Please drop an image file.');
      const choose = screen.getByRole('button', { name: 'Choose image' });
      expect(choose).not.toContainElement(error);
      expect(choose).toHaveAttribute('aria-describedby', error.id);
      expect(screen.getByRole('region', { name: 'Scan from an image' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations while the camera streams or is denied', async () => {
      const { container, unmount } = render(<QRScanner />);
      await settle();
      expect(await axe(container)).toHaveNoViolations();
      unmount();

      deny('NotAllowedError');
      const denied = render(<QRScanner />);
      await settle();
      expect(screen.getByRole('alert')).toHaveTextContent('Camera Access Denied');
      expect(await axe(denied.container)).toHaveNoViolations();
    });
  });
});
