import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '../../../tests/utils/axe';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, ShortcutHelp } from './CommandPalette';
import type { Command } from './commands';

const commandList = (run = vi.fn()): Command[] => [
  { id: 'a', label: 'Download PNG', group: 'Export', shortcut: ['Ctrl', 'S'], run },
  { id: 'b', label: 'Pattern: Swiss Dot', group: 'Pattern', run: vi.fn() },
  { id: 'c', label: 'Redo', group: 'Edit', disabled: true, run: vi.fn() },
  { id: 'd', label: 'Surprise me', group: 'Edit', run: vi.fn() },
];

describe('CommandPalette', () => {
  it('is a labelled dialog with a combobox that owns the listbox', async () => {
    render(<CommandPalette open onClose={() => {}} commands={commandList()} />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    const combobox = screen.getByRole('combobox', { name: 'Type a command' });
    expect(combobox).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'Commands' }).id);
    expect(screen.getAllByRole('option')).toHaveLength(4);
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('filters as you type and announces the count', async () => {
    render(<CommandPalette open onClose={() => {}} commands={commandList()} />);
    const combobox = screen.getByRole('combobox');
    await waitFor(() => expect(combobox).toHaveFocus());
    await userEvent.type(combobox, 'swiss');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 command available');
    await userEvent.clear(combobox);
    await userEvent.type(combobox, 'zzz');
    expect(screen.getByRole('status')).toHaveTextContent('No matching commands');
  });

  it('moves with the arrow keys, skips disabled commands and runs on Enter', async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commandList(run)} />);
    const combobox = screen.getByRole('combobox');
    await waitFor(() => expect(combobox).toHaveFocus());
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', options[0].id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs a clicked command but ignores a disabled one', async () => {
    const run = vi.fn();
    const commands = commandList(run);
    render(<CommandPalette open onClose={() => {}} commands={commands} />);
    await userEvent.click(screen.getByRole('option', { name: /Redo/ }));
    expect(commands[2].run).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('option', { name: /Download PNG/ }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commandList()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShortcutHelp', () => {
  it('lists the shortcuts with the platform modifier and passes axe', async () => {
    render(<ShortcutHelp open onClose={() => {}} modLabel="⌘" />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Undo the last appearance change')).toBeInTheDocument();
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(3);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
