/**
 * Design token guardrail (#1045, #1617). Runs on the same class strings as
 * `qrcraftly/tailwind-classes` (className/class attributes and the class helper calls) and reports:
 *  1. a raw palette colour (`bg-slate-800`, `text-teal-700`, `border-white` ...) instead of a
 *     semantic token from src/layouts/index.css (`bg-surface`, `text-accent`, `border-line` ...),
 *     unless the file is in the `legacyFiles` option (#1366);
 *  2. an arbitrary colour or size value (`text-[11px]`, `bg-[#0a0f1d]`, `border-[3px]`) instead of
 *     a scale step or token.
 * Comments and strings that are not class lists are never read, because the rule walks the AST.
 */
import path from 'node:path';
import { calleeName, CLASS_ATTRIBUTES, collect, DEFAULT_CALLEES } from './tailwind-classes.js';

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_UTILITIES =
  'bg|text|border|border-[trblxy]|ring|ring-offset|outline|divide|from|via|to|fill|stroke|shadow|accent|caret|decoration|placeholder';

const RAW_PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:/\\d+)?(?![\\w-])`,
  'g'
);
const ARBITRARY_VALUE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES}|leading|tracking)-\\[(?:#|rgba?\\(|hsla?\\(|oklch\\(|\\d)[^\\]]*\\]`,
  'g'
);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Use semantic design tokens instead of raw palette colours and arbitrary colour or size values.' },
    schema: [
      {
        type: 'object',
        properties: {
          callees: { type: 'array', items: { type: 'string' } },
          legacyFiles: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawPalette:
        'Raw palette colour "{{value}}". Fix: use a semantic token from src/layouts/index.css (for example bg-surface, text-fg-muted, border-line, bg-action, text-danger).',
      arbitrary:
        'Arbitrary value "{{value}}". Fix: use a scale step (text-xs is the 12px floor) or add a token to the @theme block in src/layouts/index.css.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    const file = path.relative(context.cwd, context.filename).split(path.sep).join('/');
    const checkPalette = !(options.legacyFiles ?? []).includes(file);
    const sourceCode = context.sourceCode;
    const seen = new Set();

    /**
     * Reports every match of a pattern inside one string piece.
     * @param {import('estree').Node} node `Literal` or `TemplateElement`.
     * @param {RegExp} pattern Global pattern.
     * @param {string} messageId Message.
     */
    const scan = (node, pattern, messageId) => {
      const [from, to] = node.range;
      for (const match of sourceCode.text.slice(from, to).matchAll(pattern)) {
        const start = from + (match.index ?? 0);
        context.report({
          loc: { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(start + match[0].length) },
          messageId,
          data: { value: match[0] },
        });
      }
    };

    /** @param {import('estree').Node[]} pieces */
    const check = (pieces) => {
      for (const node of pieces) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (checkPalette) scan(node, RAW_PALETTE_CLASS, 'rawPalette');
        scan(node, ARBITRARY_VALUE_CLASS, 'arbitrary');
      }
    };

    return {
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!CLASS_ATTRIBUTES.has(name) || !node.value) return;
        const out = [];
        collect(node.value, out);
        check(out);
      },
      CallExpression(node) {
        if (!callees.has(calleeName(node.callee))) return;
        const out = [];
        for (const argument of node.arguments) collect(argument, out);
        check(out);
      },
      TaggedTemplateExpression(node) {
        if (!callees.has(calleeName(node.tag))) return;
        const out = [];
        collect(node.quasi, out);
        check(out);
      },
    };
  },
};

export default rule;
