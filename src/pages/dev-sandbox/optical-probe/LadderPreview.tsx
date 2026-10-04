import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/FormFields';
import { OpticalLinkDisplay } from '@/components/transfer/OpticalLinkDisplay';
import {
  DEFAULT_LADDER_WEIGHTS,
  LADDER,
  LinkTracker,
  SIMULATED_RECEIVERS,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  ladderSchedule,
  observeDecode,
  simulateCapture,
  type FrameObservation,
  type LinkState,
  type SimulatedReceiver,
} from '@/packages/optical-modem';

/** Camera frames per second of the replay. */
const FPS = 30;
/** Simulated captures made for each modem profile before the replay starts. */
const CAPTURES_PER_PROFILE = 2;
const PITCH = 4;

type Outcomes = Map<number, FrameObservation[]>;

/** One simulated capture of one profile, through the real encoder, channel simulator and decoder. */
function captureOutcome(receiver: SimulatedReceiver, profileId: number, seed: number): FrameObservation | null {
  const profile = LADDER.find((r) => r.id === profileId)?.modem;
  if (!profile) return null;
  const payload = new Uint8Array(frameCapacity(profile).payloadBytes).fill(seed);
  const capture = simulateCapture(encodeModemFrame(profile, payload, seed, seed, PITCH), receiver.preset, {
    pixelsPerCell: receiver.widthPx / profile.cols,
    cellPitch: PITCH,
    seed,
  });
  return observeDecode(0, decodeModemFrame(capture, { geometries: [profile] }));
}

/**
 * A replay of the receiver's link display on simulated captures. A few frames of each modem profile
 * are made with the real encoder, channel simulator and decoder (one at a time, so the page stays
 * responsive); then the sender's interleaved cycle is replayed at 30 frames per second with those
 * results and the display updates once a second. It is a model of a camera, not a measurement.
 */
export default function LadderPreview() {
  const [receiverName, setReceiverName] = useState(SIMULATED_RECEIVERS[1].name);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'running'>('idle');
  const [state, setState] = useState<LinkState | null>(null);
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => () => stopRef.current(), []);

  const stop = useCallback(() => {
    stopRef.current();
    setPhase('idle');
  }, []);

  const start = useCallback(() => {
    const receiver = SIMULATED_RECEIVERS.find((r) => r.name === receiverName) ?? SIMULATED_RECEIVERS[0];
    const outcomes: Outcomes = new Map();
    const jobs = LADDER.filter((r) => r.modem).flatMap((r) => Array.from({ length: CAPTURES_PER_PROFILE }, (_, i) => ({ id: r.id, seed: i + 1 })));
    let cancelled = false;
    let timer = 0;
    let interval = 0;
    setPhase('preparing');
    setState(null);
    stopRef.current = () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
    const replay = (): void => {
      const cycle = ladderSchedule(DEFAULT_LADDER_WEIGHTS);
      const tracker = new LinkTracker();
      let frame = 0;
      setPhase('running');
      interval = window.setInterval(() => {
        // One second of camera frames per tick; the display is updated once, at the end.
        for (let i = 0; i < FPS; i++, frame++) {
          const timeMs = (frame * 1000) / FPS;
          const slot = cycle[frame % cycle.length];
          const list = outcomes.get(slot);
          const seen = list ? list[Math.floor(frame / cycle.length) % list.length] : null;
          // A QR rung gives this modem receiver nothing, like a frame it cannot find.
          tracker.record(seen ? { ...seen, timeMs } : { timeMs, profile: null, blocksOk: 0, blocks: 0, packetBytes: 0, failure: 'no-fiducials' });
        }
        setState(tracker.state());
      }, 1000);
    };
    const next = (): void => {
      if (cancelled) return;
      const job = jobs.shift();
      if (!job) {
        replay();
        return;
      }
      const seen = captureOutcome(receiver, job.id, job.seed);
      if (seen) outcomes.set(job.id, [...(outcomes.get(job.id) ?? []), seen]);
      timer = window.setTimeout(next, 0);
    };
    timer = window.setTimeout(next, 0);
  }, [receiverName]);

  return (
    <section className="space-y-4" aria-labelledby="probe-ladder">
      <h2 id="probe-ladder" className="text-xl font-semibold text-fg">
        Link display (simulated)
      </h2>
      <p className="text-fg-muted">
        Shows what the receiver would display while the sender cycles through the profile ladder, using captures made by the channel simulator. Nothing here is a measurement of a phone, and nothing is sent or stored. The simulated frames are made on
        this page&apos;s main thread, one at a time.
      </p>
      <SelectField label="Simulated receiver" value={receiverName} onChange={(event) => setReceiverName(event.target.value)} disabled={phase !== 'idle'}>
        {SIMULATED_RECEIVERS.map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}: {r.preset} channel, frame {r.widthPx} px wide
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap gap-3">
        <Button onClick={start} disabled={phase !== 'idle'}>
          Start the simulated link
        </Button>
        <Button variant="outline" onClick={stop} disabled={phase === 'idle'}>
          Stop
        </Button>
      </div>
      {phase === 'preparing' ? (
        <Alert variant="info" title="Preparing" role="status">
          Making simulated captures of each profile.
        </Alert>
      ) : null}
      {state ? <OpticalLinkDisplay state={state} /> : null}
    </section>
  );
}
