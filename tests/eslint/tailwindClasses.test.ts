import { Linter, RuleTester } from 'eslint';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import rule from '../../eslint/rules/tailwind-classes.js';
import { readSnapshot, snapshotKey } from '../../scripts/tailwind/design_system.js';
import { formatClasses } from '../../scripts/sort_tailwind_classes.js';

const CSS_PATH = path.resolve(__dirname, 'fixtures/index.css');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qrcraftly-tailwind-'));
const CACHE_FILE = path.join(TMP, 'tailwind.json');
const OPTIONS = [{ cssPath: CSS_PATH, cacheFile: CACHE_FILE, seedDirs: [] }];

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const div = (className: string) => `<div className="${className}" />`;

ruleTester.run('qrcraftly/tailwind-classes', rule, {
  valid: [
    { code: div('absolute z-10 flex items-center p-2'), options: OPTIONS },
    // Variants come after the base classes, grouped by variant.
    { code: div('p-2 hover:p-4 md:p-6 md:hover:p-8'), options: OPTIONS },
    // Custom and unknown classes are never flagged, and go first.
    { code: div('qr-preview custom-thing flex'), options: OPTIONS },
    // Theme tokens from the stylesheet are known.
    { code: div('bg-brand text-white'), options: OPTIONS },
    { code: div('top-[-5px] m-2! p-[3px]'), options: OPTIONS },
    // Different properties, or the same property under different variants, do not contradict.
    { code: div('block p-2 px-4 md:flex'), options: OPTIONS },
    { code: div('size-4 w-4'), options: OPTIONS },
    // Interpolations stay where they are; a class glued to one is left alone.
    { code: 'const c = (t: string) => <div className={`absolute z-10 bg-${t} ${t} p-2`} />;', options: OPTIONS },
    // Calls to other functions and other attributes are not checked.
    { code: 'other("z-10 absolute");', options: OPTIONS },
    { code: '<div title="z-10 absolute" />', options: OPTIONS },
    // Separate mergeClasses arguments may override each other on purpose.
    { code: 'mergeClasses("p-2", "p-4");', options: OPTIONS },
  ],
  invalid: [
    {
      code: div('z-10 absolute flex'),
      output: div('absolute z-10 flex'),
      options: OPTIONS,
      errors: [{ messageId: 'order' }],
    },
    {
      // Multi-line whitespace is kept.
      code: '<div className="z-10\n  absolute" />',
      output: '<div className="absolute\n  z-10" />',
      options: OPTIONS,
      errors: [{ messageId: 'order' }],
    },
    {
      code: div('md:p-6 hover:p-4 p-2'),
      output: div('p-2 hover:p-4 md:p-6'),
      options: OPTIONS,
      errors: [{ messageId: 'order' }],
    },
    {
      code: div('flex absolute flex'),
      output: div('absolute flex'),
      options: OPTIONS,
      errors: [{ messageId: 'duplicate', data: { className: 'flex' } }],
    },
    {
      code: div('p-2 p-4'),
      output: null,
      options: OPTIONS,
      errors: [
        { messageId: 'contradicting', data: { className: 'p-2', others: "'p-4'" } },
        { messageId: 'contradicting', data: { className: 'p-4', others: "'p-2'" } },
      ],
    },
    {
      code: div('block flex'),
      output: null,
      options: OPTIONS,
      errors: [{ messageId: 'contradicting' }, { messageId: 'contradicting' }],
    },
    {
      code: div('md:block md:flex'),
      output: null,
      options: OPTIONS,
      errors: [{ messageId: 'contradicting' }, { messageId: 'contradicting' }],
    },
    {
      code: div('px-2 py-2'),
      output: div('p-2'),
      options: OPTIONS,
      errors: [{ messageId: 'shorthand', data: { longhands: 'px-2 py-2', replacement: 'p-2' } }],
    },
    {
      code: div('w-4 h-4'),
      output: div('size-4'),
      options: OPTIONS,
      errors: [{ messageId: 'shorthand', data: { longhands: 'w-4 h-4', replacement: 'size-4' } }],
    },
    {
      code: div('pl-2 pr-2 pt-2 pb-2'),
      output: div('p-2'),
      options: OPTIONS,
      errors: [{ messageId: 'shorthand', data: { longhands: 'pl-2 pr-2 pt-2 pb-2', replacement: 'p-2' } }],
    },
    {
      code: div('hover:px-2 hover:py-2'),
      output: div('hover:p-2'),
      options: OPTIONS,
      errors: [{ messageId: 'shorthand' }],
    },
    {
      code: div('p-[8px]'),
      output: div('p-2'),
      options: OPTIONS,
      errors: [{ messageId: 'unnecessaryArbitrary', data: { className: 'p-[8px]', replacement: 'p-2' } }],
    },
    {
      code: div('w-[100%] z-[10]'),
      output: div('z-10 w-full'),
      options: OPTIONS,
      errors: [{ messageId: 'unnecessaryArbitrary' }, { messageId: 'unnecessaryArbitrary' }],
    },
    {
      code: div('-top-[5px]'),
      output: div('top-[-5px]'),
      options: OPTIONS,
      errors: [{ messageId: 'negativeArbitrary', data: { className: '-top-[5px]', replacement: 'top-[-5px]' } }],
    },
    {
      code: div('!m-2'),
      output: div('m-2!'),
      options: OPTIONS,
      errors: [{ messageId: 'important' }],
    },
    {
      // Template literal: each static part is checked, interpolations stay in place.
      code: 'const c = (t: string) => <div className={`z-10 absolute bg-${t} ${t} hover:p-2 p-2`} />;',
      output: 'const c = (t: string) => <div className={`absolute z-10 bg-${t} ${t} p-2 hover:p-2`} />;',
      options: OPTIONS,
      errors: [{ messageId: 'order' }, { messageId: 'order' }],
    },
    {
      code: 'mergeClasses("z-10 absolute", cond ? "p-4 p-2 p-2" : "");',
      output: 'mergeClasses("absolute z-10", cond ? "p-2 p-4" : "");',
      options: OPTIONS,
      errors: [{ messageId: 'order' }, { messageId: 'duplicate' }, { messageId: 'contradicting' }, { messageId: 'contradicting' }],
    },
    {
      code: 'const x = clsx(["z-10 absolute"], { "flex flex": on });',
      output: 'const x = clsx(["absolute z-10"], { "flex": on });',
      options: OPTIONS,
      errors: [{ messageId: 'order' }, { messageId: 'duplicate' }],
    },
    {
      code: 'const x = ctl`z-10 absolute`;',
      output: 'const x = ctl`absolute z-10`;',
      options: OPTIONS,
      errors: [{ messageId: 'order' }],
    },
  ],
});

describe('tailwind design-system snapshot', () => {
  it('rebuilds a stale snapshot and records the new key', () => {
    const staleFile = path.join(TMP, 'stale.json');
    fs.writeFileSync(staleFile, JSON.stringify({ key: 'stale', classes: { flex: 0 }, unknown: [], utilities: {} }));
    const linter = new Linter({ configType: 'flat' });
    const messages = linter.verify(div('z-10 absolute'), {
      files: ['**/*.tsx'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { qrcraftly: { rules: { 'tailwind-classes': rule } } },
      rules: { 'qrcraftly/tailwind-classes': ['error', { cssPath: CSS_PATH, cacheFile: staleFile, seedDirs: [] }] },
    }, 'stale.tsx');
    expect(messages.map((m) => m.messageId)).toEqual(['order']);
    const rebuilt = readSnapshot(staleFile);
    expect(rebuilt?.key).toBe(snapshotKey(CSS_PATH));
    expect(rebuilt?.classes).toHaveProperty('absolute');
  });

  it('keeps classes Tailwind does not know as unknown', () => {
    const snapshot = readSnapshot(CACHE_FILE);
    expect(snapshot?.unknown).toContain('custom-thing');
    expect(snapshot?.classes).not.toHaveProperty('custom-thing');
  });
});

describe('format:classes', () => {
  it('applies the same fixes as the rule and reports what it cannot fix', async () => {
    const dir = fs.mkdtempSync(path.join(TMP, 'cli-'));
    fs.writeFileSync(path.join(dir, 'a.tsx'), `export const A = () => ${div('z-10 absolute px-2 py-2')};\n`);
    fs.writeFileSync(path.join(dir, 'b.tsx'), `export const B = () => ${div('p-2 p-4')};\n`);
    const ruleOptions = { cssPath: CSS_PATH, cacheFile: CACHE_FILE, seedDirs: [] };

    const checked = await formatClasses({ targets: ['.'], check: true, cwd: dir, ruleOptions });
    expect(checked.problems.map((p) => p.file).sort()).toEqual(['a.tsx', 'b.tsx', 'b.tsx']);
    expect(fs.readFileSync(path.join(dir, 'a.tsx'), 'utf8')).toContain('z-10 absolute px-2 py-2');

    const fixed = await formatClasses({ targets: ['.'], cwd: dir, ruleOptions });
    expect(fixed.fixedFiles).toEqual(['a.tsx']);
    expect(fs.readFileSync(path.join(dir, 'a.tsx'), 'utf8')).toBe(`export const A = () => ${div('absolute z-10 p-2')};\n`);
    expect(fixed.problems.map((p) => p.message)).toEqual(["'p-2' conflicts with 'p-4'.", "'p-4' conflicts with 'p-2'."]);
  }, 30000);
});
