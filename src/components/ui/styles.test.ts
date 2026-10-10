import { describe, it, expect } from 'vitest';
import { mergeClasses, BASE_INPUT_CLASSES, TEXT_FIELD_CLASSES, TEXT_AREA_CLASSES, ERROR_INPUT_CLASSES } from './styles';

describe('mergeClasses utility', () => {
  it('should return empty string when no arguments are provided', () => {
    expect(mergeClasses()).toBe('');
    expect(mergeClasses(null, undefined, false)).toBe('');
  });

  it('should filter out falsy values', () => {
    expect(mergeClasses('px-4', null, 'py-2', undefined, false)).toBe('px-4 py-2');
  });

  it('should merge classes and deduplicate raw non-conflicting ones', () => {
    expect(mergeClasses('relative border px-4', 'relative shadow')).toContain('relative');
    // eslint-disable-next-line qrcraftly/tailwind-classes -- the duplicate is the input under test
    expect(mergeClasses('relative relative')).toBe('relative');
  });

  it('should cleanly override padding classes', () => {
    // Overriding general or specific padding
    expect(mergeClasses('px-4 py-2', 'px-6')).toBe('px-6 py-2');
    expect(mergeClasses('p-4', 'p-2')).toBe('p-2');
  });

  it('should override margin classes', () => {
    expect(mergeClasses('m-4 mx-2', 'mx-3')).toBe('m-4 mx-3');
  });

  it('should override border colors correctly', () => {
    const result = mergeClasses('border border-slate-300 dark:border-slate-700', 'border-rose-500');
    expect(result).toContain('border-rose-500');
    expect(result).not.toContain('border-slate-300');
    // dark: border color is not overridden unless dark:modifier is matched
    expect(result).toContain('dark:border-slate-700');
  });

  it('keeps a text size and a text colour together (#1046)', () => {
    const merged = mergeClasses(TEXT_FIELD_CLASSES).split(' ');
    expect(merged).toContain('text-sm');
    expect(merged).toContain('text-fg');
  });

  it('overrides only the property of the same kind', () => {
    expect(mergeClasses('text-sm text-slate-700', 'text-rose-700')).toBe('text-sm text-rose-700');
    expect(mergeClasses('text-sm text-slate-700', 'text-lg')).toBe('text-lg text-slate-700');
    expect(mergeClasses('text-left text-sm', 'text-center')).toBe('text-center text-sm');
    expect(mergeClasses('text-[13px] text-slate-700', 'text-xs')).toBe('text-xs text-slate-700');
    expect(mergeClasses('text-2xl text-white', 'truncate text-ellipsis')).toBe('text-2xl text-white truncate text-ellipsis');
  });

  it('keeps a font family and a font weight together', () => {
    expect(mergeClasses('font-mono font-semibold', 'font-bold')).toBe('font-mono font-bold');
    expect(mergeClasses('font-mono font-semibold', 'font-sans')).toBe('font-sans font-semibold');
  });

  it('swaps the input border for the danger token in the error state', () => {
    const result = mergeClasses(TEXT_FIELD_CLASSES, ERROR_INPUT_CLASSES).split(' ');
    expect(result).toContain('border-danger');
    expect(result).toContain('border');
    expect(result).not.toContain('border-line-strong');
  });

  it('treats semantic token borders as colours, not widths', () => {
    expect(mergeClasses('border border-line', 'border-2')).toBe('border-2 border-line');
    expect(mergeClasses('border-2 border-line', 'border-accent')).toBe('border-2 border-accent');
    expect(mergeClasses('border border-dashed', 'border-solid')).toBe('border border-solid');
  });
});

describe('placeholder styling and accessibility alignment', () => {
  it('uses the muted text token for placeholders in every input style', () => {
    for (const classes of [BASE_INPUT_CLASSES, TEXT_FIELD_CLASSES, TEXT_AREA_CLASSES]) {
      expect(classes.split(' ')).toContain('placeholder-fg-muted');
    }
  });

  it('should override default placeholders correctly during merging', () => {
    const result = mergeClasses(TEXT_FIELD_CLASSES, 'placeholder-danger');
    expect(result).toContain('placeholder-danger');
    expect(result).not.toContain('placeholder-fg-muted');

    // A dark-only override keeps the base placeholder for light mode.
    const resultDark = mergeClasses(TEXT_FIELD_CLASSES, 'dark:placeholder-danger');
    expect(resultDark).toContain('dark:placeholder-danger');
    expect(resultDark).toContain('placeholder-fg-muted');
  });
});
