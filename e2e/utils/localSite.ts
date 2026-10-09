/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';

const BUILD_DIR = path.join(process.cwd(), 'dist', 'client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

export interface LocalSite {
  /** Directory holding this site's private copy of the build. */
  dir: string;
  origin: string;
  /** Stops answering: open connections are dropped, so every later request fails. */
  stop: () => Promise<void>;
  /** Stops the server and deletes the copy. */
  dispose: () => Promise<void>;
}

/**
 * Serves a private copy of the built site, so a test can "deploy" by editing files or go offline
 * by stopping the server, without touching the build the other specs use. Pages resolve the way
 * Workers Static Assets serves them: `/about` answers with `about/index.html`.
 * @returns The running site.
 */
export async function serveLocalSite(): Promise<LocalSite> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrcraftly-site-'));
  fs.cpSync(BUILD_DIR, dir, { recursive: true });
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const base = path.join(dir, ...pathname.split('/').filter(Boolean));
    const file = [base, `${base}.html`, path.join(base, 'index.html')].find(
      (candidate) => candidate.startsWith(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return stopped;
  };
  return {
    dir,
    origin: `http://127.0.0.1:${port}`,
    stop,
    dispose: async () => {
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Waits until a service worker controls the page. */
export async function waitForController(page: Page) {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
}
