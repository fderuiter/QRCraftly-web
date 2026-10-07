import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import StyleGallery from './StyleGallery';
import { QRProvider, useQRStore, useQRStoreSelector } from '../../context/QRContext';
import { ToastProvider } from '../ui/Toast';
import { DEFAULT_CONFIG, PATTERNS, PRESET_COLORS } from '../../constants';
import { QRStyle } from '../../types';

vi.mock('@/packages/qr-export', () => ({
  generateQRSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>'),
}));

function Harness({ onStore }: { onStore?: (store: ReturnType<typeof useQRStore>) => void }) {
  const store = useQRStore();
  const config = useQRStoreSelector((s) => s.config);
  onStore?.(store);
  return <StyleGallery config={config} onChange={store.updateConfig} />;
}

function setup() {
  let store!: ReturnType<typeof useQRStore>;
  const utils = render(
    <ToastProvider>
      <QRProvider>
        <Harness onStore={(s) => (store = s)} />
      </QRProvider>
    </ToastProvider>
  );
  return { ...utils, store: () => store };
}

describe('StyleGallery', () => {
  it('shows a tile for every pattern and colour preset, named with their scan outlook', () => {
    setup();
    expect(within(screen.getByRole('radiogroup', { name: 'Patterns' })).getAllByRole('radio')).toHaveLength(PATTERNS.length);
    expect(within(screen.getByRole('radiogroup', { name: 'Colors' })).getAllByRole('radio')).toHaveLength(PRESET_COLORS.length);
    expect(screen.getByRole('radio', { name: 'Modern Soft pattern, expected to scan' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grunge pattern, test before printing' })).toBeInTheDocument();
  });

  it('draws the thumbnails from the visitor\'s own QR code on this device', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(PATTERNS.length + PRESET_COLORS.length));
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('applies a tile as one undoable step', async () => {
    const { store } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Swiss Dot pattern/ }));
    expect(store().getState().config.style).toBe(QRStyle.SWISS);
    expect(screen.getByRole('radio', { name: /Swiss Dot pattern/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Undo style change' }));
    expect(store().getState().config.style).toBe(DEFAULT_CONFIG.style);
  });

  it('previews a tile on mouse hover and puts the look back when the pointer leaves', () => {
    const { store, container } = setup();
    const tile = screen.getByRole('radio', { name: /Swiss Dot pattern/ });
    fireEvent.pointerOver(tile, { pointerType: 'mouse' });
    expect(store().getState().config.style).toBe(QRStyle.SWISS);
    expect(store().getState().canUndo).toBe(false);
    // The tile showing as chosen stays the one underneath the preview.
    expect(screen.getByRole('radio', { name: /Standard Industrial pattern/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.pointerLeave(container.firstElementChild as Element, { pointerType: 'mouse' });
    expect(store().getState().config.style).toBe(DEFAULT_CONFIG.style);
  });

  it('does not preview on touch', () => {
    const { store } = setup();
    fireEvent.pointerOver(screen.getByRole('radio', { name: /Swiss Dot pattern/ }), { pointerType: 'touch' });
    expect(store().getState().config.style).toBe(DEFAULT_CONFIG.style);
  });

  it('commits a hovered tile with a single step back to the original look', async () => {
    const { store } = setup();
    const tile = screen.getByRole('radio', { name: /Swiss Dot pattern/ });
    fireEvent.pointerOver(tile, { pointerType: 'mouse' });
    await userEvent.click(tile);
    expect(store().getState().config.style).toBe(QRStyle.SWISS);
    act(() => void store().undo());
    expect(store().getState().config.style).toBe(DEFAULT_CONFIG.style);
    expect(store().getState().canUndo).toBe(false);
  });

  it('Surprise me applies a look expected to scan and offers Undo', async () => {
    const { store } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Surprise me/ }));
    expect(store().getState().canUndo).toBe(true);
    expect(await screen.findByText('New style applied')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Grunge|Cyber Circuit|Starburst/, checked: true })).not.toBeInTheDocument();
  });

  it('restores the look when it unmounts during a preview', () => {
    const { store, unmount } = setup();
    fireEvent.pointerOver(screen.getByRole('radio', { name: /Swiss Dot pattern/ }), { pointerType: 'mouse' });
    const handle = store();
    unmount();
    expect(handle.getState().config.style).toBe(DEFAULT_CONFIG.style);
  });

  it('has no accessibility violations', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelectorAll('img').length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('caps state re-renders during tile generation at or below 2 updates per settlement cycle', async () => {
    let galleryRenders = 0;
    function GalleryTracker({ config, onChange }: { config: any; onChange: any }) {
      galleryRenders++;
      return <StyleGallery config={config} onChange={onChange} />;
    }

    function TestHarness() {
      const store = useQRStore();
      const config = useQRStoreSelector((s) => s.config);
      return <GalleryTracker config={config} onChange={store.updateConfig} />;
    }

    const { container } = render(
      <ToastProvider>
        <QRProvider>
          <TestHarness />
        </QRProvider>
      </ToastProvider>
    );

    const initialRenders = galleryRenders;
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(PATTERNS.length + PRESET_COLORS.length));
    const rendersDuringGeneration = galleryRenders - initialRenders;

    expect(rendersDuringGeneration).toBeLessThanOrEqual(2);
  });
});
