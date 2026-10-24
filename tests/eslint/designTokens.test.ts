import { Linter, RuleTester } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { LEGACY_PALETTE_FILES } from '../../eslint.config.js';
import rule from '../../eslint/rules/design-tokens.js';

const repoRoot = path.resolve(__dirname, '../..');
const languageOptions = { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } };
const ruleTester = new RuleTester({ languageOptions });

const at = (filename: string) => path.join(repoRoot, filename);
const OPTIONS = [{ legacyFiles: LEGACY_PALETTE_FILES }];

ruleTester.run('qrcraftly/design-tokens', rule, {
  valid: [
    // Semantic tokens in UI primitives.
    {
      code: '<div className="bg-surface text-fg-muted border-line ring-focus hover:bg-surface-hover" />',
      filename: at('src/components/ui/Thing.tsx'),
      options: OPTIONS,
    },
    // Palette colours only in files on the legacy list.
    { code: '<p className="text-slate-600" />', filename: at(LEGACY_PALETTE_FILES[0]), options: OPTIONS },
    // Arbitrary layout values are allowed, and comments are never read.
    {
      code: '// e.g. text-[12px] or bg-slate-900\n<div className="max-h-[90vh] grid-cols-[30rem_minmax(0,1fr)]" />',
      filename: at('src/components/ui/Thing.tsx'),
      options: OPTIONS,
    },
    { code: '/* bg-slate-900 */ const x = 1;', filename: at('src/a.ts'), options: OPTIONS },
    // A plain string that is not a class list is not reported.
    { code: 'const label = "text-slate-600 is a class name";', filename: at('src/a.ts'), options: OPTIONS },
    { code: '<div title="bg-[#000] text-slate-600" />', filename: at('src/a.tsx'), options: OPTIONS },
    { code: 'other("bg-slate-800");', filename: at('src/a.ts'), options: OPTIONS },
  ],
  invalid: [
    {
      // Raw palette colours in UI primitives.
      code: '<div className="bg-slate-800 text-teal-700 border-white/10 ring-indigo-600" />',
      filename: at('src/components/ui/Thing.tsx'),
      options: OPTIONS,
      errors: [
        { messageId: 'rawPalette', line: 1, data: { value: 'bg-slate-800' } },
        { messageId: 'rawPalette', line: 1, data: { value: 'text-teal-700' } },
        { messageId: 'rawPalette', line: 1, data: { value: 'border-white/10' } },
        { messageId: 'rawPalette', line: 1, data: { value: 'ring-indigo-600' } },
      ],
    },
    {
      // Raw palette colours anywhere in src (#1366).
      code: '<p className="text-slate-600" />',
      filename: at('src/pages/about/+Page.tsx'),
      options: OPTIONS,
      errors: [{ messageId: 'rawPalette', line: 1, column: 15 }],
    },
    {
      // Arbitrary colour and size values anywhere in src, legacy files included.
      code: ['<><p className="text-[11px]" />', '<div className="bg-[#0a0f1d] border-[3px]" />', '<i className="shadow-[0_0_8px_#2dd4bf]" /></>'].join('\r\n'),
      filename: at(LEGACY_PALETTE_FILES[0]),
      options: OPTIONS,
      errors: [
        { messageId: 'arbitrary', line: 1 },
        { messageId: 'arbitrary', line: 2 },
        { messageId: 'arbitrary', line: 2 },
        { messageId: 'arbitrary', line: 3 },
      ],
    },
    {
      // Class helpers, conditional pieces and template quasis are checked too.
      code: 'const c = (on: boolean) => clsx("p-2", on ? "bg-red-500" : `text-[10px] ${on}`);',
      filename: at('src/a.ts'),
      options: OPTIONS,
      errors: [
        { messageId: 'rawPalette', data: { value: 'bg-red-500' } },
        { messageId: 'arbitrary', data: { value: 'text-[10px]' } },
      ],
    },
  ],
});

describe('design token legacy list', () => {
  it('only lists files that still use a raw palette colour, so the list shrinks (#1615)', () => {
    const linter = new Linter();
    const config = [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions,
        plugins: { qrcraftly: { rules: { 'design-tokens': rule } } },
        rules: { 'qrcraftly/design-tokens': 'error' as const },
      },
    ];
    const clean = LEGACY_PALETTE_FILES.filter((file) => {
      const messages = linter.verify(fs.readFileSync(path.join(repoRoot, file), 'utf8'), config, { filename: path.join(repoRoot, file) });
      return !messages.some((message) => message.ruleId === 'qrcraftly/design-tokens' && message.messageId === 'rawPalette');
    });
    expect(clean, 'Fix: remove these files from LEGACY_PALETTE_FILES in eslint.config.js').toEqual([]);
  });
});
