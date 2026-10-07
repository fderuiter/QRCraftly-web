import { QRErrorCorrectionLevel } from '../../types';
import { DEFAULT_CONFIG, PATTERNS, PRESET_COLORS } from '../../constants';
import type { QRStore } from '../../context/QRContext';
import type { DownloadFormat } from '../ExportOptions';
import { surpriseStyle } from '../../utils/styleGallery';

/** Group heading a command is listed under. */
export type CommandGroup = 'Export' | 'Pattern' | 'Colors' | 'Error correction' | 'Edit' | 'Help';

/** One action in the command palette. */
export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Extra words that find the command. */
  keywords?: string;
  /** Key caps shown beside the command. */
  shortcut?: string[];
  /** Greyed out and skipped when true. */
  disabled?: boolean;
  run: () => void;
}

/** Export actions the generator offers the palette. */
export interface GeneratorActions {
  download: (format: DownloadFormat) => void;
  copyImage: () => void;
  copySvg: () => void;
  /** Present only where the device can share. */
  share?: () => void;
  jumpToPreview: () => void;
}

/** Everything the command list needs from the generator. */
export interface CommandHost {
  store: QRStore;
  actions: GeneratorActions;
  /** Label of the shortcut modifier key: "Ctrl" or "⌘". */
  modLabel: string;
  notifyUndo: (message: string) => void;
  exportStyleFile: () => void;
  importStyleFile: () => void;
  showShortcuts: () => void;
}

/** Shortcuts listed in the cheat sheet. `mod` is replaced by the platform's modifier key. */
export const SHORTCUT_LIST: { keys: string[]; label: string }[] = [
  { keys: ['mod', 'K'], label: 'Open the command palette' },
  { keys: ['mod', 'Z'], label: 'Undo the last appearance change' },
  { keys: ['mod', 'Shift', 'Z'], label: 'Redo' },
  { keys: ['mod', 'S'], label: 'Download in the last chosen format' },
  { keys: ['mod', 'C'], label: 'Copy the image (while the preview has focus)' },
  { keys: ['?'], label: 'Show this list' },
];

/**
 * Builds the palette's commands from the live generator.
 * @param host - The store and the actions the commands call.
 * @returns More than twenty-five commands, in display order.
 */
export function buildCommands(host: CommandHost): Command[] {
  const { store, actions, modLabel, notifyUndo } = host;
  const state = store.getState();
  const { config } = state;
  const formats: [DownloadFormat, string][] = [['png', 'PNG'], ['svg', 'SVG'], ['eps', 'EPS'], ['pdf', 'PDF'], ['jpeg', 'JPEG'], ['webp', 'WebP']];

  const commands: Command[] = [
    ...formats.map(([format, name]): Command => ({
      id: `download-${format}`,
      label: `Download ${name}`,
      group: 'Export',
      keywords: `save export image ${format}`,
      run: () => actions.download(format),
    })),
    { id: 'copy-image', label: 'Copy image', group: 'Export', keywords: 'clipboard', shortcut: [modLabel, 'C'], run: actions.copyImage },
    { id: 'copy-svg', label: 'Copy SVG code', group: 'Export', keywords: 'clipboard vector', run: actions.copySvg },
  ];
  if (actions.share) commands.push({ id: 'share', label: 'Share image', group: 'Export', run: actions.share });

  for (const pattern of PATTERNS) {
    commands.push({
      id: `pattern-${pattern.id}`,
      label: `Pattern: ${pattern.label}`,
      group: 'Pattern',
      keywords: 'style shape modules',
      run: () => store.updateConfig({ style: pattern.id }),
    });
  }
  for (const preset of PRESET_COLORS) {
    commands.push({
      id: `colors-${preset.label}`,
      label: `Colors: ${preset.label}`,
      group: 'Colors',
      keywords: 'theme palette preset',
      run: () => {
        store.updateConfig({
          fgColor: preset.fg,
          bgColor: preset.bg,
          eyeColor: preset.eye,
          eyeFrameColor: preset.eye,
          eyeBallColor: preset.eye,
        });
        notifyUndo(`${preset.label} colors applied`);
      },
    });
  }
  for (const level of Object.values(QRErrorCorrectionLevel)) {
    commands.push({
      id: `ecc-${level}`,
      label: `Error correction: ${level}`,
      group: 'Error correction',
      keywords: 'ecc reliability damage',
      run: () => store.updateConfig({ errorCorrectionLevel: level }),
    });
  }

  commands.push(
    { id: 'undo', label: 'Undo', group: 'Edit', shortcut: [modLabel, 'Z'], disabled: !state.canUndo, run: () => void store.undo() },
    { id: 'redo', label: 'Redo', group: 'Edit', shortcut: [modLabel, 'Shift', 'Z'], disabled: !state.canRedo, run: () => void store.redo() },
    {
      id: 'surprise',
      label: 'Surprise me',
      group: 'Edit',
      keywords: 'random shuffle style',
      run: () => {
        store.updateConfig(surpriseStyle(Math.random, config));
        notifyUndo('New style applied');
      },
    },
    {
      id: 'reset-colors',
      label: 'Reset colors',
      group: 'Edit',
      keywords: 'black white default',
      run: () => {
        store.updateConfig({
          fgColor: DEFAULT_CONFIG.fgColor,
          bgColor: DEFAULT_CONFIG.bgColor,
          eyeColor: DEFAULT_CONFIG.eyeColor,
          eyeFrameColor: undefined,
          eyeBallColor: undefined,
        });
        notifyUndo('Colors reset');
      },
    },
    {
      id: 'remove-logo',
      label: 'Remove logo',
      group: 'Edit',
      disabled: !config.logoUrl,
      run: () => {
        store.updateConfig({ logoUrl: null });
        notifyUndo('Logo removed');
      },
    },
    {
      id: 'toggle-border',
      label: config.isBorderEnabled ? 'Turn border off' : 'Turn border on',
      group: 'Edit',
      run: () => store.updateConfig({ isBorderEnabled: !config.isBorderEnabled }),
    },
    { id: 'export-style', label: 'Save style to a file', group: 'Edit', keywords: 'export json', run: host.exportStyleFile },
    { id: 'import-style', label: 'Load style from a file', group: 'Edit', keywords: 'import json', run: host.importStyleFile },
    { id: 'jump-preview', label: 'Go to the preview', group: 'Help', keywords: 'focus qr', run: actions.jumpToPreview },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', group: 'Help', keywords: 'keys help cheat sheet', shortcut: ['?'], run: host.showShortcuts }
  );
  return commands;
}

/**
 * Filters commands by what was typed: every word must appear in the label, group or keywords.
 * @param commands - All commands.
 * @param query - The search text.
 * @returns The matching commands, in their original order.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.group} ${command.keywords ?? ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
