import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ScannabilityIndicator } from '../src/components/ScannabilityIndicator';
import { PatternControls } from '../src/components/style-controls/PatternControls';
import QRCanvas from '../src/components/QRCanvas';
import QRTool from '../src/components/QRTool';
import { ToastProvider } from '../src/components/ui/Toast';
import { DEFAULT_CONFIG } from '../src/constants';
import { QRStyle, type QRConfig } from '../src/types';

describe('Structural Isolation and Reserved Space for QR Preview', () => {
  
  describe('Requirement 1: Scannability Feedback Wrapper Height', () => {
    it('reserves a fixed 32px slot when idle to prevent layout shift', () => {
      render(<ScannabilityIndicator status="idle" />);
      const placeholder = screen.getByTestId('scannability-indicator-placeholder');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder).toHaveClass('h-8');
    });

    it('keeps the same 32px slot while checking', () => {
      render(<ScannabilityIndicator status="checking" />);
      const wrapper = screen.getByTestId('scannability-feedback-wrapper');
      expect(wrapper).toBeInTheDocument();
      expect(wrapper).toHaveClass('h-8');
    });

    it('keeps the same 32px slot for a failing verdict and opens its details as an overlay', () => {
      const lowScannabilityHealth = {
        score: 40,
        warnings: ['Low contrast between modules and background'],
      };

      render(<ScannabilityIndicator status="fail" health={lowScannabilityHealth} />);
      const wrapper = screen.getByTestId('scannability-feedback-wrapper');
      expect(wrapper).toHaveClass('h-8');

      fireEvent.click(screen.getByTestId('scannability-pill'));
      expect(wrapper).toHaveClass('h-8');
      expect(screen.getByTestId('scannability-details')).toHaveClass('absolute');
    });
  });

  describe('Requirement 2: Conditional Style Configuration Warning', () => {
    it('does not reserve warning space when using high-reliability patterns', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        style: QRStyle.STANDARD,
      };
      const handleChange = vi.fn();
      
      render(<PatternControls config={config} onChange={handleChange} />);
      
      expect(screen.queryByTestId('pattern-warning-slot')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('renders a warning when selecting a low-reliability pattern', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        style: QRStyle.CIRCUIT, // LOW_RELIABILITY_PATTERN
      };
      const handleChange = vi.fn();
      
      render(<PatternControls config={config} onChange={handleChange} />);
      
      const slot = screen.getByTestId('pattern-warning-slot');
      expect(slot).toBeInTheDocument();
      
      // A static note: the scannability verdict is what screen readers announce (#800)
      const warningText = screen.getByRole('note');
      expect(warningText).toBeInTheDocument();
      expect(warningText).toHaveTextContent(/complex and may reduce scannability/);
    });
  });

  describe('Requirement 3: Aspect-Ratio-Locked Container for Validation Alerts', () => {
    it('uses relative container and absolute positioning for validation alerts to prevent layout jumps', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        type: 'LOCATION' as any,
        value: 'geo:invalid_lat,invalid_lon', // Trigger latitude validation error
      };
      
      // Force latitude out of bounds or longitude out of bounds via latitude/longitude config
      const invalidConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        type: 'LOCATION' as any,
        latitude: 150, // Latitude must be between -90 and 90
        longitude: 0,
        value: 'geo:150,0',
      };

      const { container } = render(<QRCanvas config={invalidConfig} />);
      
      // The canvas container should have relative, aspect-ratio and w-full classes
      const containerDiv = container.firstChild as HTMLElement;
      expect(containerDiv).toHaveClass('relative');
      expect(containerDiv).toHaveClass('aspect-square');
      expect(containerDiv).toHaveClass('w-full');
      
      // The Alert component should be nested in an absolutely-positioned wrapper
      const absoluteWrapper = containerDiv.querySelector('.absolute.inset-0');
      expect(absoluteWrapper).toBeInTheDocument();
      
      const alertElement = screen.getByRole('status');
      expect(alertElement).toBeInTheDocument();
      expect(alertElement).toHaveTextContent(/Generation Blocked/i);
    });
  });

  describe('Requirement 4: Mobile Workspace Uses Document Scrolling', () => {
    it('does not constrain the workspace or its panels to separate mobile scroll areas', () => {
      const { container } = render(
        <ToastProvider>
          <QRTool />
        </ToastProvider>
      );
      
      // The shared workspace is a single in-flow column on mobile (content first) and only
      // becomes a two-column, sticky-preview grid at the md breakpoint.
      const workspace = screen.getByTestId('tool-workspace');
      expect(workspace).toHaveClass('grid-cols-1');
      expect(workspace).not.toHaveClass('flex-col-reverse');
      expect(workspace).not.toHaveClass('h-screen');
      expect(workspace).not.toHaveClass('overflow-hidden');

      // Both panels participate in normal document flow on mobile and at high zoom.
      const settingsPanel = screen.getByLabelText(/QR Code Settings/i);
      expect(settingsPanel).not.toHaveClass('max-h-[50vh]');
      expect(settingsPanel).not.toHaveClass('overflow-y-auto');

      const previewPanel = screen.getByLabelText(/QR Code Preview/i);
      expect(previewPanel).not.toHaveClass('max-h-[50vh]');
      expect(previewPanel).not.toHaveClass('overflow-y-auto');
      expect(previewPanel).not.toHaveClass('overflow-x-hidden');

      // The preview only scrolls independently on desktop; decorative glows are clipped.
      const scroller = screen.getByTestId('tool-workspace-preview-scroller');
      expect(scroller).toHaveClass('md:overflow-y-auto');
      expect(scroller).not.toHaveClass('overflow-y-auto');
      expect(scroller).not.toHaveClass('overflow-x-hidden');
      expect(scroller.querySelector('.overflow-clip')).not.toBeNull();

      // Content entry comes before the preview in document (and therefore mobile) order.
      expect(settingsPanel.compareDocumentPosition(previewPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
