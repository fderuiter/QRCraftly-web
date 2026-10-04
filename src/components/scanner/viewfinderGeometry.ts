import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Geometry {
  /** Viewfinder size on screen. */
  cw: number;
  ch: number;
  /** Camera frame size. */
  vw: number;
  vh: number;
}

/** Tracks the viewfinder's size and the camera frame's size, to place the reticle. */
export function useViewfinderGeometry(
  containerRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean
): Geometry | null {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!active || !container || !video) return undefined;
    const measure = () => {
      const { width: cw, height: ch } = container.getBoundingClientRect();
      const { videoWidth: vw, videoHeight: vh } = video;
      setGeometry(cw > 0 && ch > 0 && vw > 0 && vh > 0 ? { cw, ch, vw, vh } : null);
    };
    measure();
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(container);
    return () => {
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [active, containerRef, videoRef]);
  return geometry;
}

/**
 * Maps a point in the camera frame to the viewfinder, which shows the frame with
 * `object-fit: cover` (and mirrored for a user-facing camera).
 */
export function toViewfinder(point: { x: number; y: number }, g: Geometry, mirrored: boolean) {
  const scale = Math.max(g.cw / g.vw, g.ch / g.vh);
  const x = (g.cw - g.vw * scale) / 2 + point.x * scale;
  return { x: mirrored ? g.cw - x : x, y: (g.ch - g.vh * scale) / 2 + point.y * scale };
}

