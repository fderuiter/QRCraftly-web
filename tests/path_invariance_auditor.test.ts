import { describe, it, expect } from 'vitest';
import { ALLOW_MARKER, scanContentForPathInvariants, scanFileForPathInvariants } from '../scripts/path_invariance_auditor.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

describe('Path Invariance Auditor', () => {
  describe('scanContentForPathInvariants', () => {
    it('should detect hardcoded Windows drive paths', () => {
      const code = `const filePath = "C:\\\\Users\\\\John\\\\file.txt";`;
      const findings = scanContentForPathInvariants(code, 'src/example.ts');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('Hardcoded Absolute Host Path');
    });

    it('should detect hardcoded Unix home paths', () => {
      const code = `const target = '/home/ubuntu/app/data.json';`;
      const findings = scanContentForPathInvariants(code, 'src/example.ts');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('Hardcoded Absolute Host Path');
    });

    it('should detect macOS user directory paths', () => {
      const code = `const macPath = '/Users/developer/code/proj';`;
      const findings = scanContentForPathInvariants(code, 'src/example.ts');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('Hardcoded Absolute Host Path');
    });

    it('should detect unhandled newline split in scripts', () => {
      const code = `const lines = rawText.split('\\n');`;
      const findings = scanContentForPathInvariants(code, 'scripts/sample.js');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('Unhandled CRLF Line Splitting');
    });

    it('should pass defensive newline split in scripts', () => {
      const code = `const lines = rawText.split(/\\r?\\n/);`;
      const findings = scanContentForPathInvariants(code, 'scripts/sample.js');
      expect(findings.length).toBe(0);
    });

    it('should detect unauthorized platform branching outside execHelper', () => {
      const code = `const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';`;
      const findings = scanContentForPathInvariants(code, 'scripts/my-script.js');
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('Ad-Hoc Platform Branching');
    });

    it('reports a platform check in execHelper.js that carries no marker (#1617)', () => {
      const code = `if (process.platform === 'win32') return command + '.cmd';`;
      const findings = scanContentForPathInvariants(code, 'scripts/utils/execHelper.js');
      expect(findings.map((f) => [f.type, f.line])).toEqual([['Ad-Hoc Platform Branching', 1]]);
    });

    it('allows a platform check that carries the marker, and only that one (#1617)', () => {
      const code = [
        `// ${ALLOW_MARKER} -- this helper is where platform differences live`,
        `if (process.platform === 'win32') return command + '.cmd';`,
        `const isWin = process.platform === 'win32';`,
      ].join('\n');
      const findings = scanContentForPathInvariants(code, 'scripts/utils/execHelper.js');
      expect(findings.map((f) => [f.type, f.line])).toEqual([['Ad-Hoc Platform Branching', 3]]);
    });

    it('does not report a path or platform check that appears only in a comment (#1617)', () => {
      const code = [
        '// Was C:\\Users\\John\\file.txt, then /home/ubuntu/app/data.json.',
        "/* process.platform === 'win32' and text.split('\\n') */",
        'const ok = 1;',
      ].join('\n');
      expect(scanContentForPathInvariants(code, 'scripts/my-script.js')).toEqual([]);
    });

    it('reports a host path in a string with the line of the string (#1617)', () => {
      const code = ['const a = 1;', '// fine: /home/ubuntu/app/data.json', "const b = '/home/ubuntu/app/data.json';"].join('\n');
      const findings = scanContentForPathInvariants(code, 'src/example.ts');
      expect(findings.map((f) => [f.type, f.line])).toEqual([['Hardcoded Absolute Host Path', 3]]);
    });

    it('still scans .json files line by line', () => {
      const findings = scanContentForPathInvariants('{\n  "root": "/home/ubuntu/app/data"\n}', 'package.json');
      expect(findings.map((f) => [f.type, f.line])).toEqual([['Hardcoded Absolute Host Path', 2]]);
    });

    it('should ignore mock strings in test files like C:\\fakepath', () => {
      const code = `const input = { value: 'C:\\\\fakepath\\\\sample.txt' };`;
      const findings = scanContentForPathInvariants(code, 'src/hooks/useAnimatedQrSender.test.ts');
      expect(findings.length).toBe(0);
    });
  });

  describe('scanFileForPathInvariants on real repo files', () => {
    it('should pass cleanly on scripts/utils/execHelper.js', () => {
      const filePath = path.join(repoRoot, 'scripts', 'utils', 'execHelper.js');
      const findings = scanFileForPathInvariants(filePath);
      expect(findings).toEqual([]);
    });

    it('should pass cleanly on tests/utils/execHelper.ts', () => {
      const filePath = path.join(repoRoot, 'tests', 'utils', 'execHelper.ts');
      const findings = scanFileForPathInvariants(filePath);
      expect(findings).toEqual([]);
    });
  });
});

