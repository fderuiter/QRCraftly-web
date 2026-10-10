import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import plugin from '../../eslint/rules/index.js';
import { findUnsafeRegex } from '../../eslint/rules/regexAnalysis.js';

// RuleTester calls these globals to group its cases.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });
const { rules } = plugin;

describe('qrcraftly/no-unsafe-regex', () => {
  tester.run('no-unsafe-regex', rules['no-unsafe-regex'], {
    valid: [
      'const a = /a+b+/;',
      'const a = /(ab)+/;',
      'const a = /^(\\d*)(?:\\.(\\d*))?$/;',
      'const a = /^border(-[xytrbl])?(-(\\d+|\\[[^\\]]+\\]))?$/;',
      'const a = /(?:a|b)*/;',
      'const a = /(.*a){3}/;',
      'const a = new RegExp("a+b");',
      'const a = new RegExp(pattern);',
      'const a = /[(+)*]+/;',
      'const a = /\\(a+\\)+/;',
      'const a = /(?:[a-z]+\\.)+com/;',
      'const a = /^(\\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$/;',
      'const a = /(?:(?:\\\\+|\\/+)[a-zA-Z0-9_.-]+)*/;',
    ],
    invalid: [
      { code: 'const a = /(a+)+/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /(\\w*)*/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /(x+x+)+y/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /(a|a)*/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /^(a|ab)*$/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /(\\d|\\w)+/;', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = new RegExp("(a+)+$");', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = RegExp(`(a*b*)*`);', errors: [{ messageId: 'unsafe' }] },
      { code: 'const a = /((a+)+-x)*/;', errors: [{ messageId: 'unsafe' }] },
    ],
  });

  it('explains the reason', () => {
    expect(findUnsafeRegex('(a+)+')).toMatch(/nests/);
    expect(findUnsafeRegex('(a|a)*')).toMatch(/alternation/);
    expect(findUnsafeRegex('a{2,5}b')).toBeNull();
  });
});

describe('qrcraftly/no-non-literal-regexp', () => {
  tester.run('no-non-literal-regexp', rules['no-non-literal-regexp'], {
    valid: [
      'new RegExp("abc", "g");',
      'new RegExp(`abc`);',
      'RegExp("x");',
      'new RegExp(/abc/, "g");',
      'new Other(pattern);',
    ],
    invalid: [
      { code: 'new RegExp(pattern);', errors: [{ messageId: 'nonLiteral' }] },
      { code: 'RegExp(prefix + "x");', errors: [{ messageId: 'nonLiteral' }] },
      { code: 'new RegExp(`^${name}$`);', errors: [{ messageId: 'nonLiteral' }] },
    ],
  });
});

describe('qrcraftly/no-bidi-characters', () => {
  tester.run('no-bidi-characters', rules['no-bidi-characters'], {
    valid: ['const a = "plain";', 'const a = "\\u202E written as an escape";', 'const a = "עברית";'],
    invalid: [
      { code: 'const a = "\u202E";', errors: [{ messageId: 'bidi', data: { code: '202E' } }] },
      { code: '// comment \u2066 hidden\nconst a = 1;', errors: [{ messageId: 'bidi', data: { code: '2066' }, line: 1 }] },
      { code: 'const a = 1; /* \u202A */ const b = "\u2069";', errors: 2 },
    ],
  });
});

describe('qrcraftly/exec-through-helper', () => {
  tester.run('exec-through-helper', rules['exec-through-helper'], {
    valid: [
      { code: 'import { execBinary } from "./utils/execHelper.js";', filename: 'scripts/x.js' },
      { code: 'import { execFileSync } from "child_process";', filename: '/repo/scripts/utils/execHelper.js' },
      { code: 'import { execFileSync } from "node:child_process";', filename: 'C:\\repo\\tests\\utils\\execHelper.ts' },
      { code: 'import fs from "node:fs";', filename: 'scripts/x.js' },
    ],
    invalid: [
      { code: 'import { execSync } from "child_process";', filename: 'scripts/x.js', errors: [{ messageId: 'direct' }] },
      { code: 'import cp from "node:child_process";', filename: 'src/x.ts', errors: [{ messageId: 'direct' }] },
      { code: 'const cp = require("child_process");', filename: 'scripts/x.cjs', errors: [{ messageId: 'direct' }] },
      { code: 'const cp = await import("node:child_process");', filename: 'tests/x.ts', errors: [{ messageId: 'direct' }] },
      { code: 'export { spawn } from "child_process";', filename: 'scripts/x.js', errors: [{ messageId: 'direct' }] },
    ],
  });
});
