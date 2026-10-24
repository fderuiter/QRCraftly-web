import React, { useRef } from 'react';
import type { CameraScanResult } from '@/packages/optical-scanner/client';
import { toViewfinder, type Geometry } from './viewfinderGeometry';

/** Two-finger pinch on the viewfinder sets the zoom (touch screens). */
export function usePinchZoom(zoom: { min: number; max: number; value: number } | null, setZoom: (value: number) => void) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (!zoom || event.pointerType !== 'touch') return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) start.current = { distance: distance(), zoom: zoom.value };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!zoom || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const from = start.current;
    if (!from || from.distance === 0 || pointers.current.size !== 2) return;
    setZoom(Math.min(zoom.max, Math.max(zoom.min, from.zoom * (distance() / from.distance))));
  };
  const onPointerEnd = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) start.current = null;
  };
  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}

/**
 * The reticle: the centre square the decoder searches first (the camera engine's region of
 * interest), drawn no larger than 70% of the viewfinder.
 */
function reticleFor(g: Geometry) {
  const scale = Math.max(g.cw / g.vw, g.ch / g.vh);
  const side = Math.min(Math.min(g.vw, g.vh) * scale, Math.min(g.cw, g.ch) * 0.7);
  return { x: (g.cw - side) / 2, y: (g.ch - side) / 2, side };
}

/** The dimmed overlay with a clear reticle, which locks onto the code's corners once found. */
export function ViewfinderOverlay({ geometry, lock, mirrored }: { geometry: Geometry | null; lock: CameraScanResult['corners']; mirrored: boolean }) {
  if (!geometry) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <div className="aspect-square w-3/5 max-w-72 rounded-xl border-3 border-on-camera/80" />
      </div>
    );
  }
  const { cw, ch } = geometry;
  const r = reticleFor(geometry);
  const square = `M${r.x} ${r.y}H${r.x + r.side}V${r.y + r.side}H${r.x}Z`;
  const quad = lock
    ? `M${lock
        .map((point) => toViewfinder(point, geometry, mirrored))
        .map(({ x, y }) => `${x} ${y}`)
        .join('L')}Z`
    : null;
  const hole = quad ?? square;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${cw} ${ch}`} aria-hidden="true" data-testid="scanner-reticle">
      <path fillRule="evenodd" fill="black" fillOpacity={0.5} d={`M0 0H${cw}V${ch}H0Z${hole}`} />
      <path
        d={hole}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinejoin="round"
        className={quad ? 'text-camera-lock' : 'text-on-camera'}
        data-locked={quad ? 'true' : undefined}
      />
    </svg>
  );
}
