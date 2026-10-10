# The QRCraftly Pledge

**QRCraftly is not ad supported, and it never will be.**

Free QR codes that never expire. No sign-up, no ads, nothing leaves your browser.

- **No ads.** No banner ads, no sponsored placements, no affiliate links and no paid upgrades. Not now and not later.
- **No tracking.** No analytics, no tracking cookies, no tracking pixels, no fingerprinting and no third-party scripts. I do not know who you are and I do not want to.
- **Entirely in your browser.** Your QR codes are made on your device. What you type, upload or scan is never sent to a server. Once the page has loaded, the generator keeps working offline.
- **Completely free.** Every feature, for everyone, with no account, no sign-up and no paid tier.

If keeping QRCraftly running ever comes down to ads or nothing, it will be nothing: I will shut the project down before a single ad goes on it. The only way QRCraftly would ever change hands is if someone buys the whole project outright.

This is the point of the project. A QR code generator should not need to know what you are encoding, and it should not be paid for by watching you. Keeping everything in your browser also makes QRCraftly fast and available anywhere, even without a connection.

Fred de Ruiter, creator of QRCraftly

The same text is published at [qrcraftly.com/free-forever](https://qrcraftly.com/free-forever). The site copy lives in `src/data/pledge.ts`; change both together.

## Exactly what is and isn't collected

What is seen or stored:

- Cloudflare, which hosts the site, handles each request for a page or file. Like any web host it sees your IP address, browser user agent, the page address and the time, uses them to deliver the site and block attacks, and shows us only aggregate totals such as request counts.
- If Cloudflare's bot protection is switched on, it may set a short-lived security cookie. It is not used for tracking.
- Your light or dark theme choice is saved in your own browser (`qrcraftly:theme`) so the site remembers it. It never leaves your device.
- Brand templates you choose to save are kept in your own browser too (`qrcraftly:brand-templates`, at most 50). They hold only style settings such as colours, patterns and borders, never your content or uploaded images, and never leave your device.

What is never collected:

- Anything you type, upload or scan, and the QR codes you make. They stay in your browser tab and are gone when you close or refresh it.
- Analytics, tracking cookies, tracking pixels, fingerprints or third-party scripts of any kind.
- Diagnostics, crash reports or usage statistics. QRCraftly reports nothing back.
- Accounts, emails or payment details. There is nothing to sign up for.

## How the claims are enforced

Each claim above is backed by something in the repository, so a change that breaks the pledge fails review or CI.

| Claim                          | Enforced by                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No third-party requests        | The Content Security Policy (`src/layouts/Head.tsx`, `scripts/csp_hash_injector.js`) sets `default-src 'self'` and `connect-src 'self'`, so the browser refuses scripts, fonts, images and connections from any other origin, including analytics beacons a host might inject. `e2e/csp-enforcement.spec.ts` checks that the policy names no external origin. |
| No hidden network calls        | `scripts/bundle_ast_audit.js` fails the build when compiled code calls `fetch` outside a short reviewed list, and bans `WebSocket`, `XMLHttpRequest` and `sendBeacon` outright. `scripts/dependency_compliance.js` blocks analytics and logging packages.                                                                                                     |
| No diagnostics or reporting    | There is no telemetry code. A scan failure is handled on the device only; `e2e/worker-recovery.spec.ts` checks that it sends no request.                                                                                                                                                                                                                      |
| Nothing you encode is stored   | `scripts/storage_privacy_ast_auditor.js` fails the build on any browser storage key outside a short allowlist (see [ADR 0001](adr/0001-client-side-storage-allowlist.md)), and `e2e/storage-verification.spec.ts` checks storage after entering data.                                                                                                         |
| Nothing you encode is in a URL | Input is never written to query parameters, so it cannot reach browser history or Cloudflare's request logs.                                                                                                                                                                                                                                                  |
| No server-side processing      | Production is Workers Static Assets with no Worker script ([ADR 0012](adr/0012-cloudflare-workers-static-assets-and-multi-environment.md)): Cloudflare serves files and runs no code of ours.                                                                                                                                                                 |

## Things that would change this page

- **Dynamic (editable) QR codes.** QRCraftly does not offer them. A redirect service would mean a server stores redirect targets and counts scans, so the code for one was removed ([ADR 0022](adr/0022-no-dynamic-qr-codes-client-side-only.md)). Bringing it back would need a new decision and an update to this page first.
- **Cloudflare dashboard settings.** Web Analytics, Workers Logs and Logpush are account settings, not code. Web Analytics would be blocked by the CSP anyway, but logs kept by Cloudflare on our behalf would need to be disclosed here.
