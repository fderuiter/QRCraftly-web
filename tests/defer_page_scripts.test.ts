// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFERRED_SCRIPTS_ID, DEFERRED_SCRIPTS_LOADER, deferPageScripts, run } from '../scripts/defer_page_scripts.js';
import { extractInlineScripts } from '../scripts/csp_hash_injector.js';

const require = createRequire(import.meta.url);
const { readAssetReferences } = require('../scripts/generate_sw.cjs') as {
  readAssetReferences: (relativePath: string, source: string) => string[];
};

const ENTRY = '<script src="/assets/entries/entry-client-routing.abc.js" type="module" async></script>';
const PRELOADS =
  '<link rel="modulepreload" href="/assets/entries/src_pages_index.def.js" as="script" type="text/javascript">' +
  '<link rel="modulepreload" href="/assets/chunks/chunk-1.js" as="script" type="text/javascript">';
const PAGE = `<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/assets/static/app.css"></head><body><div id="root"><h1>Hi</h1></div><script id="vike_pageContext" type="application/json">{}</script>${ENTRY}${PRELOADS}</body></html>`;

describe('deferPageScripts (#1058)', () => {
  it('moves the entry module and its preloads into an inert template before </body>', () => {
    const html = deferPageScripts(PAGE);
    const body = html.slice(html.indexOf('<body>'));
    expect(body).toContain(`<template id="${DEFERRED_SCRIPTS_ID}">${ENTRY}${PRELOADS}</template><script>${DEFERRED_SCRIPTS_LOADER}</script></body>`);
    const outside = html.replace(/<template[\s\S]*<\/template>/, '');
    expect(outside).not.toContain('<link rel="modulepreload"');
    expect(outside).not.toContain('<script src=');
    // The page data and the stylesheet stay where Vike put them.
    expect(html).toContain('<script id="vike_pageContext" type="application/json">{}</script>');
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="/assets/static/app.css">');
  });

  it('keeps every startup file visible to the bundle budget and the service worker shell', () => {
    expect(readAssetReferences('index.html', deferPageScripts(PAGE))).toEqual(readAssetReferences('index.html', PAGE));
  });

  it('adds one loader that is the same on every page, so the CSP needs one hash for it', () => {
    const scripts = extractInlineScripts(deferPageScripts(PAGE), true);
    expect(scripts).toEqual([DEFERRED_SCRIPTS_LOADER]);
  });

  it('leaves pages without an entry module and already rewritten pages alone', () => {
    const plain = '<html><body><p>Static</p></body></html>';
    expect(deferPageScripts(plain)).toBe(plain);
    const once = deferPageScripts(PAGE);
    expect(deferPageScripts(once)).toBe(once);
  });

  it('refuses a page without </body> rather than dropping its scripts', () => {
    expect(() => deferPageScripts(`<html>${ENTRY}`)).toThrow('</body>');
  });
});

describe('DEFERRED_SCRIPTS_LOADER', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    document.head.querySelectorAll('script[src], link[rel="modulepreload"]').forEach((node) => node.remove());
  });

  const mount = () => {
    const template = document.createElement('template');
    template.id = DEFERRED_SCRIPTS_ID;
    template.innerHTML = ENTRY + PRELOADS;
    document.body.appendChild(template);
  };

  it('starts the scripts in a task after the next frame, in their original order', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.useFakeTimers();
    try {
      mount();
      new Function(DEFERRED_SCRIPTS_LOADER)();
      expect(document.head.querySelector('script[src]')).toBeNull();
      frames.forEach((callback) => callback(0));
      expect(document.head.querySelector('script[src]')).toBeNull();
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    const started = Array.from(document.head.querySelectorAll('script[src], link[rel="modulepreload"]'));
    expect(started.map((node) => node.getAttribute('src') ?? node.getAttribute('href'))).toEqual([
      '/assets/entries/entry-client-routing.abc.js',
      '/assets/entries/src_pages_index.def.js',
      '/assets/chunks/chunk-1.js',
    ]);
    expect((started[0] as HTMLScriptElement).type).toBe('module');
    expect(document.getElementById(DEFERRED_SCRIPTS_ID)).toBeNull();
  });

  it('starts them at once in a hidden tab, which paints no frames', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    mount();
    new Function(DEFERRED_SCRIPTS_LOADER)();
    expect(document.head.querySelectorAll('script[src]')).toHaveLength(1);
  });
});

describe('run', () => {
  it('rewrites every built page in place', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defer-scripts-'));
    try {
      fs.mkdirSync(path.join(dir, 'about'));
      fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
      fs.writeFileSync(path.join(dir, 'about', 'index.html'), PAGE);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(run(dir)).toBe(2);
      expect(fs.readFileSync(path.join(dir, 'about', 'index.html'), 'utf8')).toContain(`id="${DEFERRED_SCRIPTS_ID}"`);
      expect(run(dir)).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
