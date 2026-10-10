import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
] as const;

type Value = (typeof OPTIONS)[number]['value'];

function Harness({ appearance, onChange }: { appearance?: 'track' | 'tiles'; onChange?: (v: Value) => void }) {
  const [value, setValue] = useState<Value>('b');
  return (
    <SegmentedControl<Value>
      label="Letters"
      appearance={appearance}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a labelled radio group with one checked radio and one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    radios.forEach((r) => expect(r).not.toHaveAttribute('aria-pressed'));
  });

  it('moves and selects with the arrow keys, Home and End (roving tabindex)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const bravo = screen.getByRole('radio', { name: 'Bravo' });
    bravo.focus();
    fireEvent.keyDown(bravo, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Charlie' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Charlie' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Charlie' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Charlie' })).toHaveAttribute('tabindex', '0');
  });

  it('selects on click, including the already selected option', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('slides a thumb under the selected segment in the track appearance', () => {
    render(<Harness />);
    const thumb = screen.getByTestId('segmented-thumb');
    expect(thumb).toHaveClass('w-1/3', 'translate-x-full');
    fireEvent.click(screen.getByRole('radio', { name: 'Charlie' }));
    expect(thumb).toHaveClass('translate-x-[200%]');
  });

  it('marks the selected tile with a filled tint and a check badge', () => {
    render(<Harness appearance="tiles" />);
    const bravo = screen.getByRole('radio', { name: 'Bravo' });
    expect(bravo).toHaveClass('bg-accent-soft', 'border-accent-strong');
    expect(bravo.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Alpha' }).querySelector('svg')).toBeNull();
    expect(screen.queryByTestId('segmented-thumb')).not.toBeInTheDocument();
  });

  it('supports tab semantics with panel references', () => {
    render(
      <SegmentedControl<Value>
        kind="tablist"
        label="Sections"
        options={OPTIONS}
        value="a"
        onChange={() => {}}
        tabId={(v) => `tab-${v}`}
        controls={() => 'panel'}
      />
    );
    const tab = screen.getByRole('tab', { name: 'Alpha' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('id', 'tab-a');
    expect(tab).toHaveAttribute('aria-controls', 'panel');
    expect(tab).not.toHaveAttribute('aria-checked');
  });

  it('keeps the first option as the tab stop when nothing is selected', () => {
    render(<SegmentedControl<string> label="Presets" options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} value="" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
  });

  it('disables every option', () => {
    render(<SegmentedControl<Value> label="Letters" options={OPTIONS} value="a" onChange={() => {}} disabled />);
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled());
  });

  it.each(['track', 'tiles'] as const)('has no axe violations (%s)', async (appearance) => {
    const { container } = render(<Harness appearance={appearance} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
