import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorCommands } from './GeneratorCommands';
import { buildCommands, type GeneratorActions } from './commands';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { ToastProvider } from '@/components/ui/Toast';
import { DEFAULT_CONFIG } from '@/constants';
import { STYLE_FILE_FORMAT } from '@/utils/styleFile';

vi.mock('./commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commands')>();
  return { ...actual, buildCommands: vi.fn(actual.buildCommands) };
});

function setup() {
  const actions = { download: vi.fn(), copyImage: vi.fn(), copySvg: vi.fn(), jumpToPreview: vi.fn() };
  const onDownload = vi.fn();
  let store!: ReturnType<typeof useQRStore>;
  const Grab = () => {
    store = useQRStore();
    return null;
  };
  const tree = (nextActions: GeneratorActions) => (
    <ToastProvider>
      <QRProvider>
        <Grab />
        <GeneratorCommands actions={nextActions} onDownload={onDownload} />
      </QRProvider>
    </ToastProvider>
  );
  const { rerender } = render(tree(actions));
  return { actions, onDownload, store: () => store, rerender: (nextActions: GeneratorActions) => rerender(tree(nextActions)) };
}

const styleFile = (style: Record<string, unknown>) =>
  new File([JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style })], 'brand.qrcraftly.json', { type: 'application/json' });

describe('GeneratorCommands', () => {
  it('opens the command palette with Ctrl+K and runs a command', async () => {
    const { actions } = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    const combobox = await screen.findByRole('combobox', { name: 'Type a command' });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(25));
    await userEvent.type(combobox, 'download svg');
    await userEvent.keyboard('{Enter}');
    expect(actions.download).toHaveBeenCalledWith('svg');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('builds the palette commands once per opening, not on every re-render', async () => {
    vi.mocked(buildCommands).mockClear();
    const { rerender, store } = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(25));
    expect(buildCommands).toHaveBeenCalledTimes(1);

    // New props and a store change re-render the component while the palette stays open.
    rerender({ download: vi.fn(), copyImage: vi.fn(), copySvg: vi.fn(), jumpToPreview: vi.fn() });
    act(() => store().updateConfig({ fgColor: '#222222' }));
    expect(buildCommands).toHaveBeenCalledTimes(1);

    // Closing and opening the palette again builds the list once more.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(buildCommands).toHaveBeenCalledTimes(2));
  });

  it('shows the cheat sheet with ?', async () => {
    setup();
    await userEvent.keyboard('?');
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('undoes and redoes from the keyboard', async () => {
    const { store } = setup();
    act(() => store().updateConfig({ fgColor: '#123456' }));
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(store().getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(store().getState().config.fgColor).toBe('#123456');
  });

  it('loads a style file dropped on the page and leaves content alone', async () => {
    const { store } = setup();
    act(() => store().updateConfig({ value: 'https://keep.example' }));
    const file = styleFile({ fgColor: '#112233', value: 'https://evil.example' });
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => expect(store().getState().config.fgColor).toBe('#112233'));
    expect(store().getState().config.value).toBe('https://keep.example');
    expect(await screen.findByText('Style loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store().getState().config.fgColor).toBe(DEFAULT_CONFIG.fgColor);
  });

  it('explains a file that is not a style file', async () => {
    const { store } = setup();
    const file = new File(['{"hello":1}'], 'other.json', { type: 'application/json' });
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(await screen.findByText('That is not a QRCraftly style file.')).toBeInTheDocument();
    expect(store().getState().canUndo).toBe(false);
  });

  it('loads a style from the file input', async () => {
    const { store } = setup();
    await userEvent.upload(screen.getByLabelText('Load style file'), styleFile({ bgColor: '#fafafa' }));
    await waitFor(() => expect(store().getState().config.bgColor).toBe('#fafafa'));
  });

  it('saves a style file without content', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const create = vi.fn(() => 'blob:style');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const { store } = setup();
    act(() => store().updateConfig({ value: 'https://private.example' }));
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByRole('combobox'), 'save style');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(create).toHaveBeenCalled());
    const blob = create.mock.calls[0] as unknown as [Blob];
    expect(await blob[0].text()).not.toContain('private.example');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
