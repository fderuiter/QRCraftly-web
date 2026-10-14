import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Kbd } from '../ui/Kbd';
import { filterCommands, SHORTCUT_LIST, type Command } from './commands';

interface CommandPaletteProps {
  /** Whether the palette is open. */
  open: boolean;
  /** Closes the palette. */
  onClose: () => void;
  /** Commands to list. */
  commands: readonly Command[];
}

/**
 * The searchable list inside the palette: a combobox that keeps focus in the text field and
 * points at the highlighted option with `aria-activedescendant`.
 */
function PaletteBody({ commands, onClose }: { commands: readonly Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const enabledIndexes = useMemo(() => results.flatMap((command, index) => (command.disabled ? [] : [index])), [results]);
  const activeIndex = enabledIndexes.includes(active) ? active : (enabledIndexes[0] ?? -1);

  // The dialog's focus trap puts focus on its first control; take it back for the search field.
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  };

  const move = (step: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const next = enabledIndexes[(position + step + enabledIndexes.length) % enabledIndexes.length];
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home' && event.ctrlKey) {
      setActive(enabledIndexes[0] ?? 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[activeIndex]);
    }
  };

  return (
    <div>
      <label htmlFor={`${listId}-input`} className="mb-2 block text-sm font-medium text-fg-soft">
        Type a command
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Pattern, colors, download…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-muted"
      />
      <p role="status" className="sr-only">
        {results.length === 0 ? 'No matching commands' : `${results.length} ${results.length === 1 ? 'command' : 'commands'} available`}
      </p>
      <ul id={listId} role="listbox" aria-label="Commands" className="mt-3 max-h-72 overflow-y-auto">
        {results.map((command, index) => (
          // Keyboard operation lives on the combobox input (arrow keys and Enter); options are never focused.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <li
            key={command.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            aria-disabled={command.disabled || undefined}
            onMouseMove={() => !command.disabled && setActive(index)}
            onClick={() => run(command)}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm aria-disabled:cursor-not-allowed aria-disabled:text-fg-muted aria-selected:bg-accent-soft aria-selected:text-accent-strong ${index === activeIndex ? '' : 'text-fg'}`}
          >
            <span className="min-w-0">
              {command.label}
              <span className="ml-2 text-xs text-fg-muted">{command.group}</span>
            </span>
            {command.shortcut && (
              <span className="flex shrink-0 gap-1" aria-label={`Shortcut: ${command.shortcut.join(' ')}`}>
                {command.shortcut.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="mt-3 text-sm text-fg-muted">Nothing matches “{query}”.</p>}
    </div>
  );
}

/**
 * The command palette (Ctrl/Cmd+K): a dialog with a search field over every generator
 * action, operable with the keyboard alone. Loaded on first use.
 * @param props - Component properties.
 * @param props.open - Whether it is open.
 * @param props.onClose - Closes it.
 * @param props.commands - The commands to list.
 * @returns The palette dialog.
 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Command palette" closeLabel="Close command palette" dismissOnBackdropClick>
      <PaletteBody commands={commands} onClose={onClose} />
    </Modal>
  );
}

/**
 * The keyboard shortcut cheat sheet.
 * @param props - Component properties.
 * @param props.open - Whether it is open.
 * @param props.onClose - Closes it.
 * @param props.modLabel - Label of the modifier key on this platform.
 * @returns The cheat sheet dialog.
 */
export function ShortcutHelp({ open, onClose, modLabel }: { open: boolean; onClose: () => void; modLabel: string }) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Keyboard shortcuts" closeLabel="Close keyboard shortcuts" dismissOnBackdropClick>
      <dl className="space-y-3 text-sm">
        {SHORTCUT_LIST.map((shortcut) => (
          <div key={shortcut.label} className="flex items-center justify-between gap-4">
            <dt className="text-fg-soft">{shortcut.label}</dt>
            <dd className="flex shrink-0 gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key === 'mod' ? modLabel : key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
