import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execBinary } from './utils/execHelper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sitemapScriptPath = join(__dirname, '../scripts/generate_sitemap.ts');

// A temp folder stands in for dist/client (SITEMAP_DIST_DIR), so the test never writes into
// or deletes a real build that may be running alongside it.
let distDir: string;
let sitemapPath: string;

describe('Sitemap Environment-Level Variable Resolution', () => {
  beforeAll(() => {
    distDir = mkdtempSync(join(tmpdir(), 'sitemap-env-'));
    sitemapPath = join(distDir, 'sitemap_env_test.xml');
    writeFileSync(join(distDir, 'index.html'), '<html></html>', 'utf8');
    writeFileSync(join(distDir, 'dummy-sample-route.html'), '<html></html>', 'utf8');
  });

  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  it('should use fallback domain under native tsx when import.meta.env and VITE_DOMAIN are unavailable', () => {
    execBinary('pnpm', ['exec', 'tsx', sitemapScriptPath], {
      env: {
        ...process.env,
        VITE_DOMAIN: '',
        NODE_ENV: 'production',
        SITEMAP_OUTPUT_PATH: sitemapPath,
        SITEMAP_DIST_DIR: distDir,
      },
    });

    expect(existsSync(sitemapPath)).toBe(true);
    const content = readFileSync(sitemapPath, 'utf8');
    expect(content).toContain('<loc>https://qrcraftly.com</loc>');
    expect(content).toContain('<loc>https://qrcraftly.com/dummy-sample-route</loc>');
  }, 30000);

  it('should resolve and apply a custom staging domain via process.env', () => {
    execBinary('pnpm', ['exec', 'tsx', sitemapScriptPath], {
      env: {
        ...process.env,
        VITE_DOMAIN: 'https://staging.qrcraftly.net',
        NODE_ENV: 'production',
        SITEMAP_OUTPUT_PATH: sitemapPath,
        SITEMAP_DIST_DIR: distDir,
      },
    });

    expect(existsSync(sitemapPath)).toBe(true);
    const content = readFileSync(sitemapPath, 'utf8');
    expect(content).toContain('<loc>https://staging.qrcraftly.net</loc>');
    expect(content).toContain('<loc>https://staging.qrcraftly.net/dummy-sample-route</loc>');
    expect(content).not.toContain('https://qrcraftly.com');
  }, 30000);

  it('should sanitize and strip any trailing slashes from the resolved VITE_DOMAIN', () => {
    execBinary('pnpm', ['exec', 'tsx', sitemapScriptPath], {
      env: {
        ...process.env,
        VITE_DOMAIN: 'https://staging-trailing.qrcraftly.net////',
        NODE_ENV: 'production',
        SITEMAP_OUTPUT_PATH: sitemapPath,
        SITEMAP_DIST_DIR: distDir,
      },
    });

    expect(existsSync(sitemapPath)).toBe(true);
    const content = readFileSync(sitemapPath, 'utf8');
    // Ensure no double slashes on URLs like 'https://staging-trailing.qrcraftly.net//dummy-sample-route'
    expect(content).toContain('<loc>https://staging-trailing.qrcraftly.net</loc>');
    expect(content).toContain('<loc>https://staging-trailing.qrcraftly.net/dummy-sample-route</loc>');
  }, 30000);

  it('should support loading custom domain from a .env file loaded via Vite loadEnv', () => {
    const envFilePath = join(__dirname, '../.env.production');
    const hasExistingEnv = existsSync(envFilePath);
    let originalEnvContent = '';
    if (hasExistingEnv) {
      originalEnvContent = readFileSync(envFilePath, 'utf8');
    }

    try {
      // Write temporary .env.production file specifying custom domain
      writeFileSync(envFilePath, 'VITE_DOMAIN=https://dotenv-loaded.qrcraftly.org\n', 'utf8');

      // Run the sitemap script with VITE_DOMAIN removed from process.env to ensure it loads from .env file
      const cleanedEnv = { ...process.env };
      delete cleanedEnv.VITE_DOMAIN;

      execBinary('pnpm', ['exec', 'tsx', sitemapScriptPath], {
        env: {
          ...cleanedEnv,
          NODE_ENV: 'production',
          SITEMAP_OUTPUT_PATH: sitemapPath,
          SITEMAP_DIST_DIR: distDir,
        },
      });

      expect(existsSync(sitemapPath)).toBe(true);
      const content = readFileSync(sitemapPath, 'utf8');
      expect(content).toContain('<loc>https://dotenv-loaded.qrcraftly.org</loc>');
      expect(content).toContain('<loc>https://dotenv-loaded.qrcraftly.org/dummy-sample-route</loc>');
    } finally {
      // Cleanup temporary .env.production file
      if (hasExistingEnv) {
        writeFileSync(envFilePath, originalEnvContent, 'utf8');
      } else if (existsSync(envFilePath)) {
        try {
          unlinkSync(envFilePath);
        } catch {}
      }
    }
  }, 30000);
});
