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

import { defineConfig, devices } from '@playwright/test';

/** Specs that must run with the Content Security Policy enforced (bypassCSP: false). */
const CSP_ENFORCED_SPECS = 'csp-enforcement.spec.ts';

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'development-hydration.spec.ts',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'list',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000',
    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
    /* Most projects bypass CSP so specs can instrument pages freely; the
       `chromium-csp` project below enforces the real policy (see #969). */
    bypassCSP: true,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: CSP_ENFORCED_SPECS,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: CSP_ENFORCED_SPECS,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: CSP_ENFORCED_SPECS,
      use: { ...devices['Desktop Safari'] },
    },
    {
      /* Runs against the built app (webServer below) with the shipped Content
         Security Policy enforced, so CSP regressions such as a missing blob:
         source fail here instead of only in production. */
      name: 'chromium-csp',
      testMatch: CSP_ENFORCED_SPECS,
      use: { ...devices['Desktop Chrome'], bypassCSP: false },
    },
  ],
  /* Serve the production build before starting the tests. Locally this builds
     first; CI downloads the Build job's `dist` artifact and sets
     PLAYWRIGHT_USE_EXISTING_BUILD so the app is only built once per run. */
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL ? undefined : {
    command: process.env.PLAYWRIGHT_USE_EXISTING_BUILD === 'true'
      ? 'pnpm run preview'
      : 'pnpm run build && pnpm run preview',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
