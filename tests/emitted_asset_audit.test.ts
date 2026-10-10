import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditClientDir, auditCss, auditHtml, auditScript, auditSecrets } from '../scripts/emitted_asset_audit.js';

describe('emitted asset audit (#1351)', () => {
  it('rejects HTML that loads scripts, styles, frames or images from another origin', () => {
    const html = [
      '<script src="https://cdn.example/a.js"></script>',
      '<link rel="stylesheet" href="//fonts.example/a.css">',
      '<link rel="preconnect" href="https://tracker.example">',
      '<img srcset="/a.png 1x, https://img.example/b.png 2x">',
      "<iframe src='https://ads.example/frame'></iframe>",
      '<form action="https://collect.example/submit"></form>',
      '<meta http-equiv="refresh" content="0;url=https://elsewhere.example">',
    ].join('\n');
    expect(auditHtml(html, 'index.html').map((v) => v.rule)).toEqual([
      'external-resource',
      'external-resource',
      'external-resource',
      'external-resource',
      'external-resource',
      'external-resource',
      'meta-refresh',
    ]);
  });

  it('allows same-origin resources, data and blob URLs, and plain links to other sites', () => {
    const html = [
      '<script type="module" src="/assets/entry.js"></script>',
      '<link rel="stylesheet" href="/assets/style.css">',
      '<link rel="canonical" href="https://qrcraftly.com/about">',
      '<meta property="og:image" content="https://qrcraftly.com/og-image.png">',
      '<img src="data:image/png;base64,AAAA">',
      '<a href="https://github.com/fderuiter/QRCraftly-web" rel="noopener">Source</a>',
    ].join('\n');
    expect(auditHtml(html, 'index.html')).toEqual([]);
  });

  it('rejects stylesheets that import or reference another origin', () => {
    expect(auditCss('@import url("https://fonts.example/a.css");', 'a.css')).toHaveLength(1);
    expect(auditCss('a{background:url(//img.example/b.png)}', 'a.css')).toHaveLength(1);
    expect(auditCss('a{background:url("data:image/svg+xml,%3Csvg%3E")} b{background:url(/assets/c.png)}', 'a.css')).toEqual([]);
  });

  it('rejects WebSockets and hosts nobody has reviewed, once per host', () => {
    const code = 'new WebSocket("wss://live.example");fetch("https://beacon.example/a");fetch("https://beacon.example/b")';
    expect(auditScript(code, 'a.js')).toEqual([
      { file: 'a.js', rule: 'websocket', detail: 'wss://live.example' },
      { file: 'a.js', rule: 'unreviewed-host', detail: 'beacon.example' },
    ]);
    expect(auditScript('const ns="http://www.w3.org/2000/svg";const u="https://wa.me/"+n', 'b.js')).toEqual([]);
  });

  it('finds credentials and private keys', () => {
    expect(auditSecrets('const k="AKIAABCDEFGHIJKLMNOP"', 'a.js').map((v) => v.detail)).toEqual(['AWS access key']);
    expect(auditSecrets('-----BEGIN RSA PRIVATE KEY-----', 'a.txt').map((v) => v.detail)).toEqual(['Private key']);
    expect(auditSecrets('const a=1', 'a.js')).toEqual([]);
  });

  describe('a built directory', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emitted-assets-'));
      fs.mkdirSync(path.join(dir, 'assets'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('reports each file by its POSIX path and skips binary files', () => {
      fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/assets/a.js"></script>');
      fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'fetch("https://telemetry.example/x")');
      fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(auditClientDir(dir)).toEqual([{ file: 'assets/a.js', rule: 'unreviewed-host', detail: 'telemetry.example' }]);
    });
  });
});
