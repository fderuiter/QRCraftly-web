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
        
        // The app loads nothing from other origins (#970, #1352): no data request, font, style,
        // script, image, media or beacon. Any such request fails the test. Only a top-level
        // navigation (a person following a link to another site) is aborted without failing.
        if (type !== 'document') {
          blockedRequests.push(url);
        }
        
        route.abort('failed');
      }
    });

    // QRCraftly has no server API (ADR 0022): the browser only ever reads static files. A request
    // that sends a body or uses another method could carry a payload off the device (#1352).
    const sendingRequests: string[] = [];
    context.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method()) || request.postDataBuffer()) {
        sendingRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await use(page);

    if (sendingRequests.length > 0 && testInfo.expectedStatus !== 'failed') {
      throw new Error(`Requests that send data:\n${sendingRequests.map((r) => `  - ${r}`).join('\n')}`);
    }

    // Enforce strict client-side data privacy boundaries by failing the test if any request was blocked
    console.log(`[Teardown] Blocked requests count: ${blockedRequests.length}`, blockedRequests);
    if (blockedRequests.length > 0 && testInfo.expectedStatus !== 'failed') {
      const errorMsg = `Blocked unauthorized external request(s):\n${blockedRequests.map(r => `  - ${r}`).join('\n')}`;
      throw new Error(errorMsg);
    }
  },
});

export { expect };
