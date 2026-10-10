/**
 * QRCraftly's own ESLint rules, registered as the `qrcraftly` plugin.
 *
 * The security rules replace `eslint-plugin-security` (GitHub issue #1193):
 * - `no-unsafe-regex`: regexes that can backtrack catastrophically (ReDoS);
 * - `no-non-literal-regexp`: `RegExp` built from a value that is not a literal;
 * - `no-bidi-characters`: Unicode bidi controls in source (Trojan Source, CVE-2021-42574);
 * - `exec-through-helper`: `child_process` used outside the exec helpers AGENTS.md names.
 */
import { findUnsafeRegex } from './regexAnalysis.js';

/** The only modules allowed to import `child_process`. */
export const EXEC_HELPERS = ['scripts/utils/execHelper.js', 'tests/utils/execHelper.ts'];

/**
 * The static text of a string literal or an expression-free template, or null.
 * @param {import('estree').Node | undefined} node
 * @returns {string | null}
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked ?? null;
  return null;
}

/**
 * Whether a call or `new` expression builds a `RegExp`.
 * @param {import('estree').CallExpression | import('estree').NewExpression} node
 * @returns {boolean}
 */
function isRegExpConstructor(node) {
  return node.callee.type === 'Identifier' && node.callee.name === 'RegExp';
}

/** @type {import('eslint').Rule.RuleModule} */
const noUnsafeRegex = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow regular expressions that can backtrack catastrophically (ReDoS)' },
    schema: [],
    messages: {
      unsafe: 'This regular expression can backtrack catastrophically: {{reason}}. Rewrite it so no repeated part can match the same text two ways.',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {string} pattern
     */
    function check(node, pattern) {
      let reason = null;
      try {
        reason = findUnsafeRegex(pattern);
      } catch {
        reason = null;
      }
      if (reason) context.report({ node, messageId: 'unsafe', data: { reason } });
    }
    return {
      Literal(node) {
        if ('regex' in node && node.regex) check(node, node.regex.pattern);
      },
      'CallExpression, NewExpression'(/** @type {import('estree').CallExpression | import('estree').NewExpression} */ node) {
        if (!isRegExpConstructor(node)) return;
        const pattern = staticString(/** @type {import('estree').Node | undefined} */ (node.arguments[0]));
        if (pattern !== null) check(node, pattern);
      },
    };
  },
};

/** @type {import('eslint').Rule.RuleModule} */
const noNonLiteralRegexp = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow RegExp built from a non-literal pattern' },
    schema: [],
    messages: {
      nonLiteral:
        'RegExp is built from a value that is not a literal, so its pattern (and its backtracking) is not reviewable. Use a regex literal, or disable this line with a `--` reason saying where the pattern comes from and why it is safe.',
    },
  },
  create(context) {
    return {
      'CallExpression, NewExpression'(/** @type {import('estree').CallExpression | import('estree').NewExpression} */ node) {
        if (!isRegExpConstructor(node) || node.arguments.length === 0) return;
        const pattern = /** @type {import('estree').Node} */ (node.arguments[0]);
        if (pattern.type === 'Literal' && 'regex' in pattern) return;
        if (staticString(pattern) === null) context.report({ node, messageId: 'nonLiteral' });
      },
    };
  },
};

const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;

/** @type {import('eslint').Rule.RuleModule} */
const noBidiCharacters = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Unicode bidirectional control characters (Trojan Source, CVE-2021-42574)' },
    schema: [],
    messages: {
      bidi: 'Unicode bidi control character U+{{code}} can make code read differently from how it runs (Trojan Source). Remove it, or write it as an escape such as \\u{{code}}.',
    },
  },
  create(context) {
    return {
      Program() {
        const { text } = context.sourceCode;
        for (const match of text.matchAll(BIDI)) {
          const index = match.index ?? 0;
          const start = context.sourceCode.getLocFromIndex(index);
          const end = context.sourceCode.getLocFromIndex(index + 1);
          const code = match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
          context.report({ loc: { start, end }, messageId: 'bidi', data: { code } });
        }
      },
    };
  },
};

/**
 * @param {string} name
 * @returns {boolean}
 */
const isChildProcess = name => name === 'child_process' || name === 'node:child_process';

/** @type {import('eslint').Rule.RuleModule} */
const execThroughHelper = {
  meta: {
    type: 'problem',
    docs: { description: 'Run processes only through scripts/utils/execHelper.js or tests/utils/execHelper.ts' },
    schema: [],
    messages: {
      direct:
        'Import child_process only in {{helpers}}. Use execBinary, execShell or spawnBinary from the helper, so commands resolve the same way on Windows, macOS and Linux.',
    },
  },
  create(context) {
    const file = context.filename.replace(/\\/g, '/');
    if (EXEC_HELPERS.some(helper => file.endsWith(`/${helper}`) || file === helper)) return {};
    const data = { helpers: EXEC_HELPERS.join(' and ') };
    /**
     * @param {import('estree').Node} node
     * @param {import('estree').Node | undefined | null} source
     */
    function check(node, source) {
      const name = staticString(source ?? undefined);
      if (name !== null && isChildProcess(name)) context.report({ node, messageId: 'direct', data });
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        check(node, node.source);
      },
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(node, /** @type {import('estree').Node | undefined} */ (node.arguments[0]));
        }
      },
    };
  },
};

export default {
  meta: { name: 'qrcraftly' },
  rules: {
    'no-unsafe-regex': noUnsafeRegex,
    'no-non-literal-regexp': noNonLiteralRegexp,
    'no-bidi-characters': noBidiCharacters,
    'exec-through-helper': execThroughHelper,
  },
};
