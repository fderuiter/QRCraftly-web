import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page, context }, use, testInfo) => {
    const blockedRequests: string[] = [];
    // A post-deploy run (#1228) points the suite at the deployed site, which is then the one allowed origin.
    const deployedOrigin = process.env.PLAYWRIGHT_TEST_BASE_URL ? new URL(process.env.PLAYWRIGHT_TEST_BASE_URL).origin : null;

    // Intercept and block any unmocked physical network packets initiated during user actions
    // at the browser-context level (to cover both pages and background web workers)
    await context.route('**/*', (route) => {
      const url = route.request().url();
      
      const isAllowed = (u: string) => {
        if (u.includes('unauthorized')) {
          return false;
        }
        // relative URLs or protocols that are not http/https
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
          return true;
        }
        try {
          const parsed = new URL(u);
          if (deployedOrigin && parsed.origin === deployedOrigin) return true;
          const hostname = parsed.hostname.toLowerCase();
          return (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.endsWith('.localhost')
          );
        } catch {
          return true;
        }
      };

      if (isAllowed(url)) {
        route.continue();
      } else {
        const type = route.request().resourceType();
        const errorMsg = `Blocked unauthorized external request: ${url} (type: ${type})`;
        console.warn(errorMsg);
        
        // The app loads no web fonts or stylesheets from other origins (#970), so any such
        // request is a privacy regression and fails the test like any other data request.
        if (['fetch', 'websocket', 'xmlhttprequest', 'font', 'stylesheet'].includes(type)) {
          blockedRequests.push(url);
        }
        
        route.abort('failed');
      }
    });

    await use(page);

    // Enforce strict client-side data privacy boundaries by failing the test if any request was blocked
    console.log(`[Teardown] Blocked requests count: ${blockedRequests.length}`, blockedRequests);
    if (blockedRequests.length > 0 && testInfo.expectedStatus !== 'failed') {
      const errorMsg = `Blocked unauthorized external request(s):\n${blockedRequests.map(r => `  - ${r}`).join('\n')}`;
      throw new Error(errorMsg);
    }
  },
});

export { expect };
