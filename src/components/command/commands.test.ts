import { describe, expect, it, vi } from 'vitest';
import { buildCommands, filterCommands, type CommandHost } from './commands';
import { QRStyle, QRType } from '@/packages/core/types';
import type { QRStore } from '../../context/QRContext';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { resetPatch } from '../generator/decisions';
import { resetStylePatch } from '../../utils/styleFields';

function host(overrides: Partial<CommandHost> = {}, state: Partial<ReturnType<QRStore['getState']>> = {}) {
  const store = {
    getState: () => ({ config: { ...DEFAULT_CONFIG }, moduleCount: 0, isScannabilityFallbackActive: false, canUndo: false, canRedo: false, ...state }),
    updateConfig: vi.fn(),
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
  } as unknown as QRStore;
  const actions = { download: vi.fn(), copyImage: vi.fn(), copySvg: vi.fn(), jumpToPreview: vi.fn() };
  const value: CommandHost = {
    store,
    actions,
    modLabel: 'Ctrl',
    notifyUndo: vi.fn(),
    exportStyleFile: vi.fn(),
    importStyleFile: vi.fn(),
    showShortcuts: vi.fn(),
    ...overrides,
  };
  return { value, store, actions };
}

describe('buildCommands', () => {
  it('offers at least 25 commands with unique ids', () => {
    const { value } = host();
    const commands = buildCommands(value);
    expect(commands.length).toBeGreaterThanOrEqual(25);
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
  });

  it('lists Share only where the device can share', () => {
    expect(buildCommands(host().value).some((c) => c.id === 'share')).toBe(false);
    const share = vi.fn();
    const { value } = host({ actions: { download: vi.fn(), copyImage: vi.fn(), copySvg: vi.fn(), jumpToPreview: vi.fn(), share } });
    buildCommands(value).find((c) => c.id === 'share')?.run();
    expect(share).toHaveBeenCalled();
  });

  it('applies a pattern and offers Undo for a colour preset', () => {
    const { value, store } = host();
    const commands = buildCommands(value);
    commands.find((c) => c.id === `pattern-${QRStyle.SWISS}`)?.run();
    expect(store.updateConfig).toHaveBeenCalledWith({ style: QRStyle.SWISS });
    commands.find((c) => c.id.startsWith('colors-'))?.run();
    expect(value.notifyUndo).toHaveBeenCalled();
  });

  it('disables Undo, Redo, Reset style, and Remove logo when there is nothing to do', () => {
    const commands = buildCommands(
      host({}, { config: { ...DEFAULT_CONFIG, type: QRType.WIFI, value: 'WIFI:T:WPA;S:Lab;P:pw;;' } }).value
    );
    for (const id of ['undo', 'redo', 'reset-style', 'remove-logo']) {
      expect(commands.find((c) => c.id === id)?.disabled).toBe(true);
    }
    expect(commands.find((c) => c.id === 'reset-style')?.group).toBe('Edit');

    const ready = buildCommands(
      host({}, { canUndo: true, canRedo: true, config: { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,AA' } }).value
    );
    for (const id of ['undo', 'redo', 'reset-style', 'remove-logo']) {
      expect(ready.find((c) => c.id === id)?.disabled).toBeFalsy();
    }
  });

  it('runs Surprise me, Reset colors, and Reset style through shared patches and undo toast', () => {
    const { value, store } = host(
      {},
      {
        config: {
          ...DEFAULT_CONFIG,
          style: QRStyle.SWISS,
          gradientType: 'linear',
          gradientColorStops: [
            { offset: 0, color: '#111111' },
            { offset: 1, color: '#999999' },
          ],
          logoUrl: 'data:image/png;base64,AA',
          frameText: 'SCAN ME',
        },
      }
    );
    const commands = buildCommands(value);
    commands.find((c) => c.id === 'surprise')?.run();
    commands.find((c) => c.id === 'toggle-border')?.run();
    commands.find((c) => c.id === 'reset-colors')?.run();
    expect(store.updateConfig).toHaveBeenLastCalledWith(resetPatch());
    expect(value.notifyUndo).toHaveBeenLastCalledWith('Colors reset');

    commands.find((c) => c.id === 'reset-style')?.run();
    expect(store.updateConfig).toHaveBeenLastCalledWith(resetStylePatch());
    expect(value.notifyUndo).toHaveBeenLastCalledWith('Style reset');
    expect(store.updateConfig).toHaveBeenCalledTimes(4);
  });

  it('preserves the gradient end color when applying a color preset command', () => {
    const { value, store } = host({}, {
      config: {
        ...DEFAULT_CONFIG,
        gradientType: 'linear',
        gradientColorStops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#00ff00' },
        ],
      },
    });
    const commands = buildCommands(value);
    commands.find((c) => c.id === 'colors-Slate')?.run();
    expect(store.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        fgColor: '#334155',
        gradientColorStops: [
          { offset: 0, color: '#334155' },
          { offset: 1, color: '#00ff00' },
        ],
      })
    );
  });
});

describe('filterCommands', () => {
  const commands = buildCommands(host().value);

  it('returns everything for an empty query', () => {
    expect(filterCommands(commands, '  ')).toHaveLength(commands.length);
  });

  it('requires every word to match the label, group or keywords', () => {
    const matches = filterCommands(commands, 'pattern swiss');
    expect(matches.map((c) => c.id)).toEqual([`pattern-${QRStyle.SWISS}`]);
    expect(filterCommands(commands, 'clipboard').length).toBeGreaterThanOrEqual(2);
    expect(filterCommands(commands, 'zzzz')).toEqual([]);
  });
});
