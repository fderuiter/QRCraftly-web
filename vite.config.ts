/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vike from 'vike/plugin';
import type { Plugin } from 'vite';
import type { Connect } from 'vite';
import { shippedPackages } from './scripts/vite/thirdPartyLicenses';
import { docsManifest } from './scripts/vite/docsManifest';
import { foundryDefines } from './scripts/utils/rustWorkspace.js';
import coverageThresholds from './scripts/ci/coverage_thresholds.json';

/**
 * Applies the static rules in `public/_redirects` (the file Cloudflare serves them from) in
 * `pnpm dev` and `pnpm preview`, so retired routes such as `/game` redirect locally and in
 * the Playwright suite exactly as they do in production.
 * @returns Connect middleware answering matching paths with the rule's status and location.
 */
const redirectsFileMiddleware = (): Connect.NextHandleFunction => {
  const file = path.join(process.cwd(), 'public', '_redirects');
  const rules = new Map<string, { to: string; status: number }>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [from, to, status] = line.trim().split(/\s+/);
      if (!from || from.startsWith('#') || !to) continue;
      rules.set(from, { to, status: Number(status) || 302 });
    }
  }
  return (req, res, next) => {
    const rule = rules.get((req.url ?? '').split('?')[0]);
    if (!rule) return next();
    res.statusCode = rule.status;
    res.setHeader('Location', rule.to);
    res.end();
  };
};

const redirectsFile = (): Plugin => ({
  name: 'qrcraftly:redirects-file',
  configureServer(server) {
    server.middlewares.use(redirectsFileMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(redirectsFileMiddleware());
  },
});

/**
 * Vite configuration file.
 * Configures the development server, plugins, environment variables, and path aliases.
 */
export default defineConfig(() => {
    const licenses = shippedPackages();
    const { version } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
    return {
      define: {
        // Released package version, used as softwareVersion in structured data.
        __APP_VERSION__: JSON.stringify(version),
        // Foundry canary switches, one per Rust module: FOUNDRY_<MODULE>=wasm (ADR 0033).
        ...foundryDefines(),
      },
      server: {
        port: 3000,
        host: '0.0.0.0', // Allow access from outside the container
      },
      preview: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        vike(),
        redirectsFile(),
        docsManifest(),
        licenses.plugin,
      ],
      esbuild: {
        target: 'es2022'
      },
      optimizeDeps: {
        esbuildOptions: {
          target: 'es2022'
        }
      },
      worker: {
        // Packages bundled into workers ship too, so they are listed on the acknowledgements page.
        plugins: () => [licenses.workerPlugin()],
      },
      build: {
        target: "es2022",
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              if (/[\\/]node_modules[\\/].*[\\/]node_modules[\\/](react|react-dom|scheduler|vike|vike-react)[\\/]/.test(id)) return 'vendor';
              return undefined;
            },
          },
        }
      },
      test: {
        globals: true,
        testTimeout: 15000,
        projects: [
          {
            extends: true,
            test: {
              name: 'unit-logic',
              environment: 'node',
              include: [
                'src/**/*.test.{ts,tsx}',
                'tests/**/*.test.{ts,tsx}',
              ],
              exclude: [
                '**/*.test.tsx',
                'src/hooks/**/*.test.ts',
                'src/utils/qrRenderer.test.ts',
                '**/node_modules/**',
                '**/dist/**',
                'e2e/**',
                // Agent worktrees are copies of the repository, not part of it.
                '.claude/**',
              ],
            },
          },
          {
            extends: true,
            test: {
              name: 'browser-ui',
              environment: 'jsdom',
              setupFiles: ['./vitest.setup.ts'],
              include: [
                '**/*.test.tsx',
                'src/hooks/**/*.test.ts',
                'src/utils/qrRenderer.test.ts',
              ],
              exclude: [
                '**/node_modules/**',
                '**/dist/**',
                'e2e/**',
                // Agent worktrees are copies of the repository, not part of it.
                '.claude/**',
              ],
            },
          },
        ],
        coverage: {
          reporter: ['text', 'json-summary', 'json'],
          reportOnFailure: true,
          // Floors set just under the measured totals for the scope below; raise
          // them as coverage improves, never lower them to make a PR pass.
          // Measured on dev when this scope was introduced: statements 80.4%,
          // branches 73.1%, functions 86.1%, lines 81.4%. The floors live in a
          // JSON file so the CI coverage summary (scripts/ci/coverage_summary.js)
          // shows the same numbers without parsing this config.
          thresholds: { ...coverageThresholds },
          // Measure the logic layers: shared utilities and the deep-module
          // packages. Components, hooks and pages are exercised by the jsdom
          // project and Playwright but not gated here.
          include: [
            'src/utils/**/*.ts',
            'src/packages/**/*.ts',
          ],
          exclude: [
            '**/*.test.ts',
            '**/*.d.ts',
          ],
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      }
    };
});
