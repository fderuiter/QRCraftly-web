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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handOffBlob, triggerFileDownload } from './downloadManager';

interface Clicked {
  href: string;
  download: string;
  attached: boolean;
}

describe('downloadManager', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
  let clicked: Clicked[];

  beforeEach(() => {
    createObjectURL = vi.fn((_blob: Blob) => 'blob:handoff-1');
    revokeObjectURL = vi.fn((_url: string) => undefined);
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });
  });

  afterEach(() => {
    Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('handOffBlob as a download', () => {
    it('makes an object URL of the blob, clicks a link named as given, then revokes the URL', () => {
      const blob = new Blob(['<svg/>'], { type: 'image/svg+xml;charset=utf-8' });
      handOffBlob(blob, { kind: 'download', fileName: 'my code-qr-code.svg' });

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clicked).toEqual([{ href: 'blob:handoff-1', download: 'my code-qr-code.svg', attached: true }]);
      expect(revokeObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:handoff-1');
    });

    it('removes the link from the document after the click', () => {
      handOffBlob(new Blob(['x']), { kind: 'download', fileName: 'a.txt' });
      expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    });

    it('does not rename the file, so a reserved device name is kept as given', () => {
      handOffBlob(new Blob(['{}']), { kind: 'download', fileName: 'con.qrcraftly.json' });
      expect(clicked[0]?.download).toBe('con.qrcraftly.json');
    });

    it('does not open a tab', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      handOffBlob(new Blob(['x']), { kind: 'download', fileName: 'a.txt' });
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('handOffBlob in a new tab', () => {
    it('opens the object URL in a new tab with noopener', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      handOffBlob(new Blob(['%PDF']), { kind: 'open', revokeAfterMs: 60_000 });

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith('blob:handoff-1', '_blank', 'noopener');
      expect(clicked).toHaveLength(0);
    });

    it('keeps the URL alive for the lifetime it is given, then revokes it', () => {
      vi.useFakeTimers();
      vi.spyOn(window, 'open').mockReturnValue(null);
      handOffBlob(new Blob(['x']), { kind: 'open', revokeAfterMs: 60_000 });

      vi.advanceTimersByTime(59_999);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:handoff-1');
    });
  });

  describe('triggerFileDownload', () => {
    it('sanitizes the name before it reaches the link', () => {
      triggerFileDownload(new Uint8Array([1, 2, 3]), '../evil.exe', 'application/pdf');

      expect(clicked[0]?.download).toBe('_evil.exe');
    });

    it('passes the bytes with the MIME type and revokes the URL it made', () => {
      triggerFileDownload(new Uint8Array([1, 2, 3]), 'doc.pdf', 'application/pdf');

      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob?.type).toBe('application/pdf');
      expect(blob?.size).toBe(3);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:handoff-1');
    });

    it('defaults the MIME type to application/octet-stream', () => {
      triggerFileDownload(new Uint8Array([0]), 'data.bin');

      expect(createObjectURL.mock.calls[0]?.[0].type).toBe('application/octet-stream');
    });
  });
});
