import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/FormFields';
import {
  FrameRateMeter,
  ProbeRun,
  drawProbeFrame,
  formatProbeReport,
  grantedSettings,
  loadOpticalModem,
  probeSequence,
  watchFrames,
  type FrameTick,
  type ProbeCamera,
  type ProbeMeta,
  type ProbePattern,
} from '@/packages/optical-modem';
import { PHOTOSENSITIVITY_NOTICE } from '@/utils/photosensitivity';
import LadderPreview from './LadderPreview';

/**
 * Marks this tool's chunk for `scripts/check-bundle-size.js`, which leaves it out of the site-total
 * ceiling. Keep it equal to `OPTICAL_PROBE_MARKER` there.
 */
const PROBE_CHUNK_MARKER = 'qrcraftly-optical-probe-chunk';

/** How long each pattern plays, in seconds, for the sender. */
const DWELL_SECONDS = 3;
/** Flicker patterns are held shorter. */
const FLICKER_SECONDS = 4;
/** A frame of the analysis is taken at most this often. */
const ANALYSIS_GAP_MS = 60;

function dwellMs(pattern: ProbePattern): number {
  return (pattern.kind === 'flicker' ? FLICKER_SECONDS : DWELL_SECONDS) * 1000;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface SenderProps {
  onStop: () => void;
}

/** Full-screen player of the probe sequence. */
function SenderScreen({ onStop, flicker }: SenderProps & { flicker: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return undefined;
    const patterns = probeSequence().filter((p) => flicker || p.kind !== 'flicker');
    const session = crypto.getRandomValues(new Uint32Array(1))[0];
    const scale = window.devicePixelRatio || 1;
    let index = 0;
    let counter = 0;
    let since = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      if (now - since > dwellMs(patterns[index])) {
        index++;
        since = now;
        if (index >= patterns.length) {
          onStop();
          return;
        }
      }
      counter++;
      const image = drawProbeFrame(patterns[index], session, counter);
      if (canvas.width !== image.width || canvas.height !== image.height) {
        canvas.width = image.width;
        canvas.height = image.height;
        // One canvas pixel is one device pixel, so the cells keep their exact size.
        canvas.style.width = `${image.width / scale}px`;
        canvas.style.height = `${image.height / scale}px`;
      }
      context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
      if (counter % 20 === 1) setLabel(`${index + 1} of ${patterns.length}: ${patterns[index].label}`);
      frame = requestAnimationFrame(tick);
    };
    let cancelled = false;
    // The frames are drawn with the modem module's constellations and header code.
    loadOpticalModem().then(
      () => {
        if (!cancelled) frame = requestAnimationFrame(tick);
      },
      () => {
        if (!cancelled) onStop();
      }
    );
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onStop();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [flicker, onStop]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-sunken">
      <canvas ref={canvasRef} style={{ imageRendering: "pixelated" }} aria-label="Probe pattern" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 bg-surface p-3">
        <p role="status" className="text-sm text-fg-muted">
          {label}
        </p>
        <Button variant="danger" onClick={onStop}>
          Stop (Escape)
        </Button>
      </div>
    </div>
  );
}

function Sender() {
  const [flicker, setFlicker] = useState(false);
  const [playing, setPlaying] = useState(false);
  const reduced = prefersReducedMotion();
  const stop = useCallback(() => setPlaying(false), []);
  return (
    <section className="space-y-4" aria-labelledby="probe-sender">
      <h2 id="probe-sender" className="text-xl font-semibold text-fg">
        Sender
      </h2>
      <p className="text-fg-muted">
        Plays {probeSequence().filter((p) => p.kind !== 'flicker').length} fixed patterns, {DWELL_SECONDS} seconds each: cell sizes from 8 down to 2 device pixels, in black and white and in 4, 8 and 16 colours, then a slanted edge. Hold
        the receiving phone steady (or prop it) about a screen-width away and move closer until the camera reads the frame. Every frame carries four corner markers and a calibration strip.
      </p>
      <Alert variant="warning" title="Flashing light">
        {PHOTOSENSITIVITY_NOTICE} The patterns change on every screen refresh. Press Escape or Stop to end them.
      </Alert>
      <CheckboxField
        label="Also play the flicker patterns (30, 60 and 120 Hz colour alternation, low contrast)"
        checked={flicker && !reduced}
        disabled={reduced}
        onChange={(event) => setFlicker(event.target.checked)}
      />
      {reduced ? <p className="text-sm text-fg-muted">Flicker patterns are off because your device asks for reduced motion.</p> : null}
      <Button onClick={() => setPlaying(true)}>Start the sequence</Button>
      {playing ? <SenderScreen onStop={stop} flicker={flicker && !reduced} /> : null}
    </section>
  );
}

interface ReceiverProps {
  meta: Omit<ProbeMeta, 'camera'>;
}

function Receiver({ meta }: ReceiverProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef<ProbeRun | null>(null);
  const cameraRef = useRef<ProbeCamera | null>(null);
  const stopLoopRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState('');
  const [want4k, setWant4k] = useState(false);

  const stop = useCallback(() => {
    stopLoopRef.current();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const run = runRef.current;
    if (run) {
      run.meta = { ...run.meta, camera: cameraRef.current ?? undefined };
      setReport(formatProbeReport(run.report()));
    }
    setState('idle');
  }, []);

  useEffect(() => () => stopLoopRef.current(), []);

  const start = useCallback(async () => {
    setReport('');
    setMessage('');
    try {
      // The analysis runs in the modem module.
      await loadOpticalModem();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: want4k ? 3840 : 1920 }, height: { ideal: want4k ? 2160 : 1080 }, frameRate: { ideal: 60 } },
      });
      streamRef.current = stream;
      const granted = grantedSettings(stream.getVideoTracks()[0]);
      cameraRef.current = { ...granted };
      runRef.current = new ProbeRun({ ...meta, camera: cameraRef.current });
      const video = videoRef.current;
      if (!video) throw new Error('No video element');
      video.srcObject = stream;
      await video.play();
      setState('running');
      let cancelled = false;
      let busy = false;
      let lastAnalysis = 0;
      let lastRateUpdate = 0;
      const meter = new FrameRateMeter(2000);
      const onFrame = (tick: FrameTick): void => {
        const { now } = tick;
        meter.record(tick);
        if (now - lastRateUpdate >= 2000 && cameraRef.current) {
          cameraRef.current.deliveredFps = meter.fps;
          lastRateUpdate = now;
        }
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { willReadFrequently: true });
        if (!busy && canvas && context && now - lastAnalysis > ANALYSIS_GAP_MS && video.videoWidth > 0) {
          busy = true;
          lastAnalysis = now;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          // Analysis runs after this callback returns, so the next camera frame is never held up.
          setTimeout(() => {
            const run = runRef.current;
            if (run && !cancelled) {
              const pattern = run.ingest(image, now);
              const summary = run.report();
              setProgress(`${summary.framesAnalysed} frames analysed, last pattern: ${pattern === null ? 'not readable' : probeSequence()[pattern].label}`);
            }
            busy = false;
          }, 0);
        }
      };
      const watcher = watchFrames(video, onFrame);
      stopLoopRef.current = () => {
        cancelled = true;
        watcher.stop();
      };
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'The camera could not be opened.');
    }
  }, [meta, want4k]);

  return (
    <section className="space-y-4" aria-labelledby="probe-receiver">
      <h2 id="probe-receiver" className="text-xl font-semibold text-fg">
        Receiver
      </h2>
      <p className="text-fg-muted">
        Opens the camera and reads the sender&apos;s patterns on this device. Nothing is sent anywhere: the report below is plain text for you to copy.
      </p>
      <CheckboxField label="Ask for 4K capture (only where the device grants it)" checked={want4k} onChange={(event) => setWant4k(event.target.checked)} disabled={state === 'running'} />
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void start()} disabled={state === 'running'}>
          Start the camera
        </Button>
        <Button variant="outline" onClick={stop} disabled={state !== 'running'}>
          Stop and make the report
        </Button>
      </div>
      {state === 'error' ? (
        <Alert variant="error" title="Camera">
          {message}
        </Alert>
      ) : null}
      <video ref={videoRef} muted playsInline className="max-h-64 w-full rounded border border-line bg-surface-sunken object-contain" aria-label="Camera preview" />
      <canvas ref={canvasRef} hidden />
      <p role="status" className="text-sm text-fg-muted">
        {progress}
      </p>
      {report ? (
        <div className="space-y-2">
          <label htmlFor="probe-report" className="block text-sm font-medium text-fg">
            Report (copy it; nothing leaves this device)
          </label>
          <textarea id="probe-report" readOnly value={report} rows={18} className="w-full rounded border border-line bg-surface p-2 font-mono text-xs text-fg" />
          <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(report)}>
            Copy the report
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** The probe tool: a sender and a receiver, both on this page. */
export default function ProbeApp() {
  const [device, setDevice] = useState('');
  const [direction, setDirection] = useState('');
  const [mode, setMode] = useState<ProbeMeta['mode']>('unspecified');
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-8" data-tool={PROBE_CHUNK_MARKER}>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-fg">Optical channel probe</h1>
        <p className="text-fg-muted">
          Experimental. Measures what a phone camera resolves of a screen through the browser: cell size, colour separation and frame rate. It makes no network calls and stores nothing.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Labels for the report">
        <TextField label="Device" value={device} onChange={(event) => setDevice(event.target.value)} placeholder="Phone model" maxLength={60} />
        <TextField label="Direction" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="laptop to phone" maxLength={60} />
        <SelectField label="Held" value={mode} onChange={(event) => setMode(event.target.value === 'handheld' ? 'handheld' : event.target.value === 'propped' ? 'propped' : 'unspecified')}>
          <option value="unspecified">Not stated</option>
          <option value="handheld">Handheld</option>
          <option value="propped">Propped</option>
        </SelectField>
      </section>
      <Sender />
      <Receiver meta={{ device, direction, mode }} />
      <LadderPreview />
    </main>
  );
}
