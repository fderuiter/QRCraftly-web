import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import QRTool from '@/components/QRTool';
import StyleControls from '@/components/StyleControls';
import { TypeSelector } from '@/components/inputs/TypeSelector';
import { generateQRSvg } from '@/packages/qr-export';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType, type QRConfig, TemplateStyle } from '@/types';
import { expandAppearanceSections } from './utils/expandAppearanceSections';

// Controls for mock values
let mockScannabilityStatus = 'pass';
let mockScannabilityHealth = { score: 100, warnings: [] as string[] };

// Mock useScannability to control scannability status programmatically
vi.mock('@/hooks/useScannability', () => ({
  useScannability: () => ({
    status: mockScannabilityStatus,
    checkScannability: vi.fn(),
    health: mockScannabilityHealth,
  }),
}));

// Mock QRCanvas because canvas and context interactions can be problematic in jsdom
vi.mock('@/components/QRCanvas', () => ({
  default: () => (
    <div data-testid="qr-canvas-mock">
      <canvas data-testid="mock-canvas" />
    </div>
  ),
}));

/**
 * Custom helper to programmatically expand all style panel sections.
 * This ensures no interactive element gets skipped in the keyboard tab sequence.
 * @param container - The container element holding the style panels.
 * @param onChange - Callback function to simulate config changes.
 */
export function expandAllStyleSections(container: HTMLElement, onChange: any) {
  // 0. Expand the collapsed appearance accordion sections.
  expandAppearanceSections(container);

  // 1. Expand "Advanced Mode" if not already expanded.
  const advancedBtn = within(container).queryByRole('button', { name: /Advanced Mode/i });
  if (advancedBtn && advancedBtn.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(advancedBtn);
  }

  // 2. Expand "Border" by changing config to enable border if needed.
  if (onChange) {
    onChange({ isBorderEnabled: true });
  }

  // 3. Expand "Layout" options by choosing a template style.
  if (onChange) {
    onChange({ templateStyle: TemplateStyle.SOLID_FRAME });
  }
}

describe('Modular Accessibility Test Helpers & Full Panel Sweep', () => {
  beforeEach(() => {
    mockScannabilityStatus = 'pass';
    mockScannabilityHealth = { score: 100, warnings: [] };
    vi.clearAllMocks();
  });

  // Requirement 1 / AC 1: Warning Dialog Focus Restoration
  it('restores focus to the triggering element when the safety gate warning dialog is closed', async () => {
    // Force scannability status to 'fail' to trigger the safety gate warning modal
    mockScannabilityStatus = 'fail';
    mockScannabilityHealth = { score: 50, warnings: ['Low Contrast'] };

    render(
      <ToastProvider>
        <QRTool />
      </ToastProvider>
    );

    // Locate the primary Download button and export from it
    const downloadBtn = screen.getByRole('button', { name: /^Download (PNG|SVG|JPEG|WebP)$/ });
    downloadBtn.focus();
    fireEvent.click(downloadBtn);

    // Verify warning dialog is open
    expect(screen.getByText('Scan Safety Warning')).toBeInTheDocument();

    // Find and click 'Go Back' inside the modal to cancel/close the warning
    const goBackBtn = screen.getByRole('button', { name: 'Go Back' });
    fireEvent.click(goBackBtn);

    // Confirm that the warning dialog is hidden
    await waitFor(() => {
      expect(screen.queryByText('Scan Safety Warning')).not.toBeInTheDocument();
    });

    // Verify focus is restored to the element that opened the dialog (the Download button)
    expect(document.activeElement).toBe(downloadBtn);
  });

  // Requirement 2 / AC 2: Bidirectional & Boundary Keyboard Navigation
  it('exposes QR types as ordinary links in document order without arrow-key interception', () => {
    render(<TypeSelector currentType={QRType.URL} />);
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(12);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    links.forEach((link) => {
      // Every link is in the natural Tab order (no roving tabindex)
      expect(link).not.toHaveAttribute('tabindex');
    });

    links[0].focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(fireEvent.keyDown(links[0], { key })).toBe(true);
      expect(document.activeElement).toBe(links[0]);
    }
  });

  // Requirement 3 / AC 3: Contrast Alerts Polite Live Region Updates
  it('updates polite screen-reader live regions with contrast alerts during color combinations changes', () => {
    const mockOnChange = vi.fn();

    // High contrast styling configuration (no warning active)
    const highContrastConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      fgColor: '#000000',
      bgColor: '#ffffff',
    };

    const { rerender } = render(
      <StyleControls config={highContrastConfig} onChange={mockOnChange} />
    );

    // The banner's live region is already mounted and silent, so the warning is announced when it appears
    expect(screen.getByRole('status')).toHaveTextContent('');

    // Rerender with low contrast styling configuration (e.g. white foreground on white background)
    const lowContrastConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      fgColor: '#ffffff',
      bgColor: '#ffffff',
    };

    rerender(<StyleControls config={lowContrastConfig} onChange={mockOnChange} />);

    // Assert screen-reader live region exists, is polite, and is populated with the warning alert
    const statusAlert = screen.getByRole('status');
    expect(statusAlert).toHaveAttribute('aria-live', 'polite');
    expect(statusAlert).toHaveTextContent(/Warning: The contrast ratio is low/);
    // One live region only: the warning card inside it is a static note, so it is not read twice (#800)
    expect(statusAlert.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  // Requirement 4 / AC 4: SVG Meta-tag Inspection (Title & Description tags)
  it('inspects exported SVG documents to ensure correct, descriptive accessible meta-tags for data structures', async () => {
    // 1. Verify URL configuration SVG titles/descriptions
    const urlConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'https://qrcraftly.com/a11y',
    };
    const urlSvg = await generateQRSvg(urlConfig);
    expect(urlSvg).toContain('<title>URL QR Code</title>');
    expect(urlSvg).toContain('<desc>https://qrcraftly.com/a11y</desc>');

    // 2. Verify WiFi configuration SVG titles/descriptions
    const wifiConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.WIFI,
      value: 'WIFI:T:WPA;S:MyA11yWiFiNetwork;P:superpass;;',
    };
    const wifiSvg = await generateQRSvg(wifiConfig);
    expect(wifiSvg).toContain('<title>WiFi Network QR Code</title>');
    expect(wifiSvg).toContain('<desc>MyA11yWiFiNetwork</desc>');

    // 3. Verify Contact (vCard) configuration SVG titles/descriptions
    const vcardConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.VCARD,
      value: 'BEGIN:VCARD\nVERSION:3.0\nN:A11y;Engineer\nFN:A11y Engineer\nORG:W3C\nEND:VCARD',
    };
    const vcardSvg = await generateQRSvg(vcardConfig);
    expect(vcardSvg).toContain('<title>Contact QR Code</title>');
    expect(vcardSvg).toContain('<desc>Engineer A11y</desc>');
  });

  // Requirement 5 / AC 5: Programmatic Style Sections Expansion Helper
  it('utilizes custom helper to programmatically expand all style sections and checks interactive sequence compliance', () => {
    const mockOnChange = vi.fn();
    
    // Initial configuration with Border disabled and Template Style as NONE
    const collapsedConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: false,
      templateStyle: TemplateStyle.NONE,
    };

    const { container, rerender } = render(
      <StyleControls config={collapsedConfig} onChange={mockOnChange} />
    );

    // Call custom helper to expand style panels
    expandAllStyleSections(container, mockOnChange);

    // Simulate standard parent react state update after calling onChange by re-rendering with expanded attributes
    const expandedConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      templateStyle: TemplateStyle.SOLID_FRAME,
    };
    rerender(<StyleControls config={expandedConfig} onChange={mockOnChange} />);

    // Validate Advanced Mode has expanded
    const advancedToggle = screen.getByRole('button', { name: /Advanced Mode/i });
    expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Error Correction Level')).toBeInTheDocument();

    // Validate Border section has expanded
    expect(screen.getByLabelText('Style')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Text on border...')).toBeInTheDocument();

    // Validate Layout/Template details has expanded
    expect(screen.getByPlaceholderText('Headline (e.g. Scan Me!)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Subtext (e.g. @yourhandle)')).toBeInTheDocument();

    // Query all interactive/focusable elements
    // Radio groups and tab lists use a roving tab stop: their other options are tabindex -1 on purpose.
    const interactiveSelector = 'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    container.querySelectorAll('[role="radiogroup"], [role="tablist"]').forEach((group) => {
      const stops = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]')).filter((el) => el.tabIndex === 0);
      expect(stops).toHaveLength(1);
    });
    const interactiveElements = Array.from(container.querySelectorAll(interactiveSelector));

    // Confirm that every interactive element is visible, has valid dimensions, and is included in keyboard focus order
    expect(interactiveElements.length).toBeGreaterThan(0);
    interactiveElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      expect(htmlElement).toBeVisible();
      expect(htmlElement.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });
});
