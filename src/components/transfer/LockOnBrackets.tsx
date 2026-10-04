import type { RefObject } from 'react';
import type { ScanCorners } from '@/packages/optical-scanner/client';
import { toViewfinder, useViewfinderGeometry } from '../scanner/viewfinderGeometry';

/** How far each bracket arm reaches along the code's edge, as a share of that edge. */
const ARM = 0.28;

export interface LockOnBracketsProps {
  /** The viewfinder box the video fills. */
  containerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Whether the video is running. */
  active: boolean;
  /** The corners of the code the camera just read, or null once none was read lately. */
  corners: ScanCorners | null;
}

/**
 * Corner brackets that snap to the QR code the camera is reading (#1062). They sit over the
 * video, ignore pointer input and are hidden from screen readers, which hear the progress
 * announcements instead.
 */
export function LockOnBrackets({ containerRef, videoRef, active, corners }: LockOnBracketsProps) {
  const geometry = useViewfinderGeometry(containerRef, videoRef, active);
  if (!geometry || !corners) return null;
  const points = corners.map((corner) => toViewfinder(corner, geometry, false));
  const path = points
    .map((point, index) => {
      const next = points[(index + 1) % 4];
      const prev = points[(index + 3) % 4];
      const toward = (to: { x: number; y: number }) => `${point.x + (to.x - point.x) * ARM} ${point.y + (to.y - point.y) * ARM}`;
      return `M${toward(prev)}L${point.x} ${point.y}L${toward(next)}`;
    })
    .join('');
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full text-success"
      viewBox={`0 0 ${geometry.cw} ${geometry.ch}`}
      aria-hidden="true"
      data-testid="lock-on-brackets"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
