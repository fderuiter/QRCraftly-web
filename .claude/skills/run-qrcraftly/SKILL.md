---
name: run-qrcraftly
description: Build, run, and drive the QRCraftly web app (Vike + React on Vite). Use when asked to start the dev server or production preview, take a screenshot of a page, click through the generator or QR code checker, download a generated code, confirm a UI change works in the real app, call a src/packages function directly, or run unit and Playwright e2e tests in this container.
---

QRCraftly is a static, client-side React site. An agent runs it by starting
the Vite dev server (or `pnpm preview` of a build) on port 3000 and driving it
with `.claude/skills/run-qrcraftly/driver.mjs`, a small headless-Chromium REPL
that reads one command per line from stdin and writes screenshots to
`/tmp/qrcraftly-shots/`. Paths below are relative to the repo root.

## Setup

Node 22 and pnpm 11 are preinstalled in the cloud container; Chromium is at
`/opt/pw-browsers/chromium`. No apt packages are needed.

```bash
pnpm install --frozen-lockfile
```

It warns `Unsupported engine` on Node 22.22.0 (`.nvmrc` wants 22.22.2).
Install, dev, build, tests and the TypeScript scripts all worked anyway.

## Run (agent path)

Start the dev server in the background and poll until it answers:

```bash
(pnpm dev > /tmp/qrcraftly-dev.log 2>&1 &)
timeout 60 bash -c 'until curl -sf http://127.0.0.1:3000/ >/dev/null; do sleep 1; done'
```

Then pipe commands to the driver. This flow generates a code, checks the
in-app scannability verdict, downloads the PNG, and reads it back with the
app's own QR code checker:

```bash
node .claude/skills/run-qrcraftly/driver.mjs <<'EOF'
nav /
fill label=Website URL | https://example.com/skill-check
wait-text testid=scannability-verdict | Scans reliably
shot-el testid=qr-stage | qr-example
download role=button:Download PNG
nav /qr-code-checker
upload label=Choose a picture of a QR code | @last
wait-text testid=scan-result-host | example.com
text testid=scan-result
screenshot checker-result
viewport 390 844
nav /
screenshot home-mobile
console --errors
EOF
```

Each command echoes as `> cmd`, and failures print `ERROR:` without stopping
the script. The driver exits 1 if any command failed. Open the PNGs it prints
with the Read tool to look at them.

| command                                                          | what it does                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `nav <path\|url>`                                                | goes to `http://127.0.0.1:3000<path>` and waits for `main[data-hydrated="true"]` |
| `viewport <w> <h>`                                               | resizes the viewport (default 1440x900)                                          |
| `wait-for <sel>` / `wait-text <sel> \| <text>`                   | waits for visibility or for text                                                 |
| `click <sel>`, `fill <sel> \| <text>`, `press <key>`             | interacts with the page (`fill` is React-safe)                                   |
| `upload <sel> \| <file>`                                         | sets a file input; `@last` means the last download                               |
| `download <sel>`                                                 | clicks and saves the file into `/tmp/qrcraftly-shots/`                           |
| `screenshot [name]`, `shot-el <sel> \| [name]`                   | captures the page or one element                                                 |
| `text <sel>`, `attr <sel> \| <name>`, `count <sel>`, `eval <js>` | reads the page                                                                   |
| `console [--errors]`                                             | prints console lines and page errors captured so far                             |
| `help`, `quit`                                                   | lists commands, closes                                                           |

Selectors are `role=<role>:<accessible name>`, `label=<label text>`,
`testid=<data-testid>`, `text=<text>`, `placeholder=<text>`, or plain CSS.
Put a pipe with a space on each side between a selector and a value. Useful handles: `label=Website URL`
(`#url-input`), `testid=qr-stage`, `testid=scannability-verdict`,
`role=radio:SVG` / `role=radio:PDF` (export format), `role=button:Download PNG`,
`testid=scan-result`, `testid=scan-result-host`. Mine `e2e/*.spec.ts` for more.

Env overrides: `QRC_BASE_URL` (default `http://127.0.0.1:3000`), `QRC_OUT`
(default `/tmp/qrcraftly-shots`), `QRC_CHROMIUM` (Chromium binary).

Stop the server:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

### Production build and preview

Use this for anything that only exists after `postbuild` (CSP hashes, the
service worker, the sitemap, the bundle audits). Build takes about 20 s.

```bash
pnpm build > /tmp/qrcraftly-build.log 2>&1
(pnpm preview > /tmp/qrcraftly-preview.log 2>&1 &)
timeout 60 bash -c 'until curl -sf http://127.0.0.1:3000/ >/dev/null; do sleep 1; done'
node .claude/skills/run-qrcraftly/driver.mjs <<'EOF'
nav /
fill label=Website URL | https://example.com/preview
wait-text testid=scannability-verdict | Scans reliably
click role=radio:SVG
download role=button:Download SVG
eval navigator.serviceWorker.controller ? 'sw' : 'no-sw'
console --errors
EOF
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

## Direct invocation (no browser)

Most PRs touch `src/packages/*` or components. Call a package function with
Node's type stripping and the repo's resolve hook:

```bash
node --import ./scripts/utils/register-ts.js --input-type=module -e "
import { constructWifiString } from './src/packages/qr-payload/index.ts';
console.log(constructWifiString({ ssid: 'Cafe;Guest', encryption: 'nopass', hidden: false }));
"
# -> WIFI:T:nopass;S:Cafe\;Guest;;
```

## Test

Run the tests for the files you touched:

```bash
pnpm exec vitest run src/packages/qr-payload/tests/wifi.test.ts src/components/inputs/WifiInput.test.tsx
```

Playwright e2e needs the browser shim from Gotchas. With a build already in
`dist/`, it starts `pnpm preview` itself and stops it afterwards:

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-shim PLAYWRIGHT_USE_EXISTING_BUILD=true \
  pnpm exec playwright test e2e/smoke.spec.ts e2e/landing-pages.spec.ts --project=chromium
```

The full gates are `pnpm run lint`, `pnpm test` and `pnpm build` (AGENTS.md).

## Gotchas

- **The pre-commit secret scanner rejects `password: '...'` literals**, even
  in docs and test snippets. Keep sample passwords out of committed files.

- **Download hangs in Chromium.** The app uses `showSaveFilePicker` when it
  exists, which opens a native dialog that never resolves headless. The driver
  deletes it in an init script, so the app falls back to `<a download>`. The
  e2e specs do the same thing.
- **The downloaded filename follows the content** (`url-example.com.png`), so
  pass `@last` to `upload` rather than guessing the name.
- **The scannability verdict starts as `Checking…`** and settles a second or
  two after an edit, once the worker has run. Wait for the text with
  `wait-text`, as in the flow above. Plain `wait-for` returns too early.
- **Playwright 1.62 wants Chromium build 1234; the container has 1194.**
  `chromium.launch()` and `playwright test` fail with "Executable doesn't
  exist at /opt/pw-browsers/chromium_headless_shell-1234/...". The driver
  passes `executablePath: /opt/pw-browsers/chromium`. For `playwright test`,
  build a shim directory once (don't run `playwright install`):

  ```bash
  S=/tmp/pw-shim
  mkdir -p $S/chromium_headless_shell-1234/chrome-headless-shell-linux64 $S/chromium-1234/chrome-linux64
  ln -sf /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell $S/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
  ln -sf /opt/pw-browsers/chromium-1194/chrome-linux/chrome $S/chromium-1234/chrome-linux64/chrome
  touch $S/chromium_headless_shell-1234/INSTALLATION_COMPLETE $S/chromium-1234/INSTALLATION_COMPLETE
  ```

  If a later Playwright bump changes the expected build number, the error
  message names the new path; rename the two `-1234` directories to match.

- **`pnpm test` is `vitest`, which watches in a terminal.** Use
  `pnpm exec vitest run <files>` for a one-shot run.
- **Dev and preview both use port 3000.** Kill the listener before switching,
  or the second server fails to bind. `$!` after `pnpm dev &` is only the pnpm
  wrapper, so kill by port.
- **The preview registers a service worker.** Each driver run starts a fresh
  browser context, so a stale cache does not carry between runs.
