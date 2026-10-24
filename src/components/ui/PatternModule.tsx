import React from 'react';
import { QRStyle } from '@/packages/core/types';

const patternRenderers: Record<QRStyle, React.ReactNode> = {
  [QRStyle.STARBURST]: (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-full">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </div>
  ),
  [QRStyle.HIVE]: (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 100 100" fill="currentColor" className="size-full">
        <polygon points="50,0 100,25 100,75 50,100 0,75 0,25" />
      </svg>
    </div>
  ),
  [QRStyle.SWISS]: <div className="rounded-full bg-current" />,
  [QRStyle.MODERN]: <div className="rounded-sm bg-current" />,
  [QRStyle.FLUID]: (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-full">
        <path d="M12 3a4 4 0 0 0-4 4c0 1.2.5 2.3 1.3 3.1-.8.8-1.3 1.9-1.3 3.1a5 5 0 1 0 8 0c0-1.2-.5-2.3-1.3-3.1.8-.8 1.3-1.9 1.3-3.1a4 4 0 0 0-4-4z" />
      </svg>
    </div>
  ),
  [QRStyle.CIRCUIT]: (
    <div className="relative flex size-full items-center justify-center bg-transparent">
      <div className="size-1.5 rounded-full bg-current" />
      <div className="absolute inset-0 border border-current opacity-50" />
    </div>
  ),
  [QRStyle.GRUNGE]: (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 100 100" fill="currentColor" className="size-full">
        <polygon points="10,0 100,10 90,100 0,90" />
      </svg>
    </div>
  ),
  [QRStyle.STANDARD]: <div className="bg-current" />,
};

/**
 * Helper component for rendering pattern preview modules.
 */
export const PatternModule: React.FC<{ style: QRStyle }> = ({ style }) => {
  return <>{patternRenderers[style] || patternRenderers[QRStyle.STANDARD]}</>;
};
