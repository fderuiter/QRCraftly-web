import { describe, expect, it } from 'vitest';
import { auditDesignTokens, LEGACY_PALETTE_FILES } from '../scripts/design_token_audit.js';

describe('design token audit', () => {
  it('rejects raw palette colours in UI primitives', () => {
    const errors = auditDesignTokens([
      { file: 'src/components/ui/Thing.tsx', source: '<div className="bg-slate-800 text-teal-700 border-white/10 ring-indigo-600" />' },
    ]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('src/components/ui/Thing.tsx:1');
    expect(errors[0]).toContain('bg-slate-800');
  });

  it('accepts semantic tokens in UI primitives', () => {
    expect(
      auditDesignTokens([
        { file: 'src/components/ui/Thing.tsx', source: '<div className="bg-surface text-fg-muted border-line ring-focus hover:bg-surface-hover" />' },
      ]),
    ).toEqual([]);
  });

  it('rejects raw palette colours anywhere in src (#1366)', () => {
    const errors = auditDesignTokens([{ file: 'src/pages/about/+Page.tsx', source: '<p className="text-slate-600" />' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('text-slate-600');
  });

  it('allows palette colours only in files on the legacy list', () => {
    const [legacy] = LEGACY_PALETTE_FILES;
    expect(auditDesignTokens([{ file: legacy, source: '<p className="text-slate-600" />' }])).toEqual([]);
  });

  it('rejects arbitrary colour and size values anywhere in src', () => {
    const errors = auditDesignTokens([
      {
        file: 'src/pages/x/+Page.tsx',
        source: ['<p className="text-[11px]" />', '<div className="bg-[#0a0f1d] border-[3px]" />', '<i className="shadow-[0_0_8px_#2dd4bf]" />'].join('\r\n'),
      },
    ]);
    expect(errors.map(e => e.split(' ')[0])).toEqual([
      'src/pages/x/+Page.tsx:1',
      'src/pages/x/+Page.tsx:2',
      'src/pages/x/+Page.tsx:2',
      'src/pages/x/+Page.tsx:3',
    ]);
  });

  it('allows arbitrary layout values and ignores comments', () => {
    expect(
      auditDesignTokens([
        { file: 'src/components/ui/Thing.tsx', source: '// e.g. text-[12px] or bg-slate-900\n<div className="max-h-[90vh] grid-cols-[30rem_minmax(0,1fr)]" />' },
      ]),
    ).toEqual([]);
  });
});
