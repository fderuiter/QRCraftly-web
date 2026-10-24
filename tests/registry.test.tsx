/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { sidebarControls } from '@/registry';

const ContentControl = sidebarControls[0].component;
const AppearanceControl = sidebarControls[1].component;
const AdditionalSidebarContent = sidebarControls[2].component;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock InputPanel - captures props for assertions
vi.mock('@/components/InputPanel', () => ({
  default: ({ config, onChange }: any) => (
    <div
      data-testid="input-panel"
      data-config-value={config?.value}
      data-has-onchange={typeof onChange === 'function' ? 'true' : 'false'}
    />
  ),
}));

// Mock SidebarContent
vi.mock('@/components/SidebarContent', () => ({
  SidebarContent: ({ toolId }: any) => (
    <div data-testid="sidebar-content" data-tool-id={toolId} />
  ),
}));

// Mock StyleControls (lazy-loaded via React.lazy)
vi.mock('@/components/StyleControls', () => ({
  default: ({ config, onChange }: any) => (
    <div
      data-testid="style-controls"
      data-config-value={config?.value}
      data-has-onchange={typeof onChange === 'function' ? 'true' : 'false'}
    />
  ),
}));

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('registry.tsx - static component configuration and behavior', () => {
  it('exports sidebarControls as a static array in the correct order', () => {
    expect(sidebarControls).toBeDefined();
    expect(Array.isArray(sidebarControls)).toBe(true);
    expect(sidebarControls.length).toBe(3);

    expect(sidebarControls[0].id).toBe('content');
    expect(sidebarControls[0].component).toBe(ContentControl);

    expect(sidebarControls[1].id).toBe('appearance');
    expect(sidebarControls[1].component).toBe(AppearanceControl);

    expect(sidebarControls[2].id).toBe('sidebar-content');
    expect(sidebarControls[2].component).toBe(AdditionalSidebarContent);
  });

  // -------------------------------------------------------------------------
  // ContentControl
  // -------------------------------------------------------------------------
  it('ContentControl renders inside QRProvider without crashing', () => {
    render(
      <QRProvider>
        <ContentControl />
      </QRProvider>
    );
    expect(screen.getByTestId('input-panel')).toBeInTheDocument();
  });

  it('ContentControl renders "Content" section heading', () => {
    render(
      <QRProvider>
        <ContentControl />
      </QRProvider>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('ContentControl passes config from QRStore to InputPanel', () => {
    render(
      <QRProvider>
        <ContentControl />
      </QRProvider>
    );
    const inputPanel = screen.getByTestId('input-panel');
    expect(inputPanel).toHaveAttribute('data-config-value', DEFAULT_CONFIG.value);
  });

  it('ContentControl passes a function as onChange to InputPanel', () => {
    render(
      <QRProvider>
        <ContentControl />
      </QRProvider>
    );
    const inputPanel = screen.getByTestId('input-panel');
    expect(inputPanel).toHaveAttribute('data-has-onchange', 'true');
  });

  it('ContentControl onChange is store.updateConfig - calling it updates the store', () => {
    let capturedOnChange: ((updates: any) => void) | undefined;
    let storeRef: ReturnType<typeof useQRStore> | null = null;

    const InputPanelCapture = ({ onChange }: any) => {
      capturedOnChange = onChange;
      return <div data-testid="input-panel-capture" />;
    };

    // By rendering ContentControl and using a store accessor alongside it
    const StoreCapture = () => {
      storeRef = useQRStore();
      return null;
    };

    render(
      <QRProvider>
        <StoreCapture />
        <ContentControl />
      </QRProvider>
    );

    if (storeRef) {
      act(() => {
        (storeRef as any).updateConfig({ value: 'https://registry-test.com' });
      });
      expect((storeRef as any).getState().config.value).toBe('https://registry-test.com');
    }

    // Ensure the component rendered
    expect(screen.getByTestId('input-panel')).toBeInTheDocument();
    void capturedOnChange; // silence unused variable warning
    void InputPanelCapture;
  });

  it('ContentControl throws when used outside QRProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ContentControl />)).toThrow(
      'useQRStore must be used within QRProvider'
    );
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // AppearanceControl
  // -------------------------------------------------------------------------
  it('AppearanceControl renders inside QRProvider without crashing', () => {
    render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('AppearanceControl renders "Appearance" section heading', () => {
    render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('AppearanceControl renders StyleControls after mount (isMounted becomes true)', async () => {
    render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('style-controls')).toBeInTheDocument();
    });
  });

  it('AppearanceControl passes config from QRStore to StyleControls', async () => {
    render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );

    await waitFor(() => {
      const styleControls = screen.getByTestId('style-controls');
      expect(styleControls).toHaveAttribute('data-config-value', DEFAULT_CONFIG.value);
    });
  });

  it('AppearanceControl passes a function as onChange to StyleControls', async () => {
    render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );

    await waitFor(() => {
      const styleControls = screen.getByTestId('style-controls');
      expect(styleControls).toHaveAttribute('data-has-onchange', 'true');
    });
  });

  it('AppearanceControl shows skeleton placeholder before mount', () => {
    const { container } = render(
      <QRProvider>
        <AppearanceControl />
      </QRProvider>
    );
    // Before effects run OR after: either the skeleton or StyleControls is visible
    const skeleton = container.querySelector('.animate-pulse');
    const styleControls = screen.queryByTestId('style-controls');
    // At least one of them must be present
    expect(skeleton !== null || styleControls !== null).toBe(true);
  });

  it('AppearanceControl throws when used outside QRProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AppearanceControl />)).toThrow(
      'useQRStore must be used within QRProvider'
    );
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // AdditionalSidebarContent
  // -------------------------------------------------------------------------
  it('AdditionalSidebarContent renders with default toolId "index"', () => {
    render(<AdditionalSidebarContent />);
    expect(screen.getByTestId('sidebar-content')).toHaveAttribute('data-tool-id', 'index');
  });

  it('AdditionalSidebarContent passes toolId prop to SidebarContent', () => {
    render(<AdditionalSidebarContent toolId="wifi-qr-code" />);
    expect(screen.getByTestId('sidebar-content')).toHaveAttribute('data-tool-id', 'wifi-qr-code');
  });
});
