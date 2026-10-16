import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  auditStorageFile,
  isExcludedFile,
  ALLOWED_STORAGE_KEYS
} from '../scripts/storage_privacy_ast_auditor.js';

describe('Pre-Build Storage Privacy AST Auditor Guardrail', () => {
  const tempViolatingFile = path.resolve('src/temp-storage-violating.ts');
  const tempCleanFile = path.resolve('src/temp-storage-clean.ts');

  beforeAll(() => {
    // Write a temporary file containing unauthorized persistent storage calls
    fs.writeFileSync(
      tempViolatingFile,
      `
      export function persistData(payload: string, dynamicKey: string) {
        // Unauthorized key
        localStorage.setItem('qr_payload_data', payload);
        
        // Unresolvable dynamic key
        localStorage.getItem(dynamicKey);
        
        // Unauthorized storage APIs
        sessionStorage.setItem('temp_qr_state', payload);
        indexedDB.open('QRDatabase');
        document.cookie = 'user_session=12345';
        caches.open('qr-cache-v1');
        
        // Unauthorized bracket key access
        const value = localStorage['unapproved_key_access'];
      }
      `,
      'utf8'
    );

    // Write a clean temporary file with authorized storage operations
    fs.writeFileSync(
      tempCleanFile,
      `
      export function handlePreferences() {
        const templates = localStorage.getItem('qrcraftly:brand-templates');
        localStorage.setItem('qrcraftly:brand-templates', JSON.stringify([]));

        const theme = localStorage.getItem('qrcraftly:theme');
        localStorage.setItem('qrcraftly:theme', 'dark');

        localStorage.setItem('__test__', '1');
        localStorage.removeItem('__test__');
      }
      `,
      'utf8'
    );
  });

  afterAll(() => {
    if (fs.existsSync(tempViolatingFile)) fs.unlinkSync(tempViolatingFile);
    if (fs.existsSync(tempCleanFile)) fs.unlinkSync(tempCleanFile);
  });

  describe('ALLOWED_STORAGE_KEYS', () => {
    it('contains all authorized persistent storage keys', () => {
      expect(ALLOWED_STORAGE_KEYS.has('qr-telemetry-opt-in')).toBe(false);
      expect(ALLOWED_STORAGE_KEYS.has('qrcraftly:dynamic-redirects')).toBe(false);
      expect(ALLOWED_STORAGE_KEYS.has('qrcraftly:dynamic-consent-accepted')).toBe(false);
      expect(ALLOWED_STORAGE_KEYS.has('qrcraftly:theme')).toBe(true);
      expect(ALLOWED_STORAGE_KEYS.has('qrcraftly:brand-templates')).toBe(true);
      expect(ALLOWED_STORAGE_KEYS.has('__test__')).toBe(true);
    });

    it('allows only the documented preference, template and probe keys', () => {
      expect([...ALLOWED_STORAGE_KEYS].sort()).toEqual([
        '__test__',
        'qrcraftly:brand-templates',
        'qrcraftly:theme',
      ]);
    });
  });

  describe('isExcludedFile', () => {
    it('correctly identifies files to exclude from storage scanning', () => {
      expect(isExcludedFile(path.resolve('node_modules/react/index.js'))).toBe(true);
      expect(isExcludedFile(path.resolve('dist/assets/index.js'))).toBe(true);
      expect(isExcludedFile(path.resolve('src/components/QRTool.test.tsx'))).toBe(true);
      expect(isExcludedFile(path.resolve('tests/storage_privacy_ast_auditor.test.ts'))).toBe(true);
      expect(isExcludedFile(path.resolve('scripts/storage_privacy_ast_auditor.js'))).toBe(true);
      expect(isExcludedFile(path.resolve('src/components/QRTool.tsx'))).toBe(false);
    });
  });

  describe('auditStorageFile', () => {
    it('should catch unauthorized persistent storage keys, banned APIs, and dynamic expressions', () => {
      const violations = auditStorageFile(tempViolatingFile);
      expect(violations.length).toBeGreaterThan(0);

      const types = violations.map(v => v.type);
      expect(types).toContain('Unauthorized Persistent Storage Key');
      expect(types).toContain('Unresolvable Dynamic Storage Key');
      expect(types).toContain('Unauthorized Persistent Storage API Call');
      expect(types).toContain('Unauthorized Cookie Storage Call');

      const messages = violations.map(v => v.message);
      expect(messages.some(m => m.includes('qr_payload_data'))).toBe(true);
      expect(messages.some(m => m.includes('sessionStorage'))).toBe(true);
      expect(messages.some(m => m.includes('indexedDB'))).toBe(true);
      expect(messages.some(m => m.includes('document.cookie'))).toBe(true);
      expect(messages.some(m => m.includes('caches'))).toBe(true);
      expect(messages.some(m => m.includes('unapproved_key_access'))).toBe(true);
    });

    it('should pass cleanly for compliant source files using allowed keys', () => {
      const violations = auditStorageFile(tempCleanFile);
      expect(violations.length).toBe(0);
    });

    it('should ignore test files completely', () => {
      const testFileWithStorage = path.resolve('src/context/QRContext.test.tsx');
      const violations = auditStorageFile(testFileWithStorage);
      expect(violations.length).toBe(0);
    });
  });
});
