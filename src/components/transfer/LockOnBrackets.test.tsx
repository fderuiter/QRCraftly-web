// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ScanCorners } from '@/packages/optical-scanner/client';
import { LockOnBrackets } from './LockOnBrackets';

const corners: ScanCorners = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

/** A viewfinder 400 wide and 400 high showing a 400 by 400 camera frame, so points map one to one. */
function renderBrackets(cornersProp: ScanCorners | null) {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ width: 400, height: 400 }) as DOMRect;
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: 400 });
  Object.defineProperty(video, 'videoHeight', { value: 400 });
  const containerRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  const videoRef = createRef<HTMLVideoElement>() as { current: HTMLVideoElement | null };
  containerRef.current = container as HTMLDivElement;
  videoRef.current = video;
  return render(<LockOnBrackets containerRef={containerRef} videoRef={videoRef} active corners={cornersProp} />);
}

describe('LockOnBrackets', () => {
  it('draws nothing until a code was read', () => {
    renderBrackets(null);
    expect(screen.queryByTestId('lock-on-brackets')).toBeNull();
  });

  it('draws four brackets at the code corners and hides them from screen readers', () => {
    renderBrackets(corners);
    const svg = screen.getByTestId('lock-on-brackets');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    const d = svg.querySelector('path')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(4);
    expect(d).toContain('L100 100');
    expect(d).toContain('L300 300');
  });
});
