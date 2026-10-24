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

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useImage } from './useImage';

describe('useImage', () => {
  let originalImage: any;

  beforeEach(() => {
    originalImage = window.Image;
  });

  afterEach(() => {
    window.Image = originalImage;
  });

  it('should return null when url is null', () => {
    const { result } = renderHook(() => useImage(null));
    expect(result.current).toBeNull();
  });

  it('should successfully load an image', () => {
    let mockImg: any;
    window.Image = class {
      onload: any;
      onerror: any;
      src = '';
      complete = false;
      naturalHeight = 0;
      constructor() {
        mockImg = this;
      }
    } as any;

    const { result } = renderHook(() => useImage('http://example.com/image.png'));

    expect(result.current).toBeNull();

    act(() => {
      mockImg.onload();
    });

    expect(result.current).toBe(mockImg);
  });

  it('should return null if the image fails to load', () => {
    let mockImg: any;
    window.Image = class {
      onload: any;
      onerror: any;
      src = '';
      complete = false;
      naturalHeight = 0;
      constructor() {
        mockImg = this;
      }
    } as any;

    const { result } = renderHook(() => useImage('http://example.com/image.png'));

    act(() => {
      mockImg.onerror();
    });

    expect(result.current).toBeNull();
  });

  it('should handle cached images immediately', () => {
    let mockImg: any;
    window.Image = class {
      onload: any;
      onerror: any;
      src = '';
      complete = true;
      naturalHeight = 100; // Simulated as loaded
      constructor() {
        mockImg = this;
      }
    } as any;

    const { result } = renderHook(() => useImage('http://example.com/image.png'));

    expect(result.current).toBe(mockImg);
  });

  it('should clean up handlers on unmount', () => {
    let mockImg: any;
    window.Image = class {
      onload: any;
      onerror: any;
      src = '';
      complete = false;
      naturalHeight = 0;
      constructor() {
        mockImg = this;
      }
    } as any;

    const { unmount } = renderHook(() => useImage('http://example.com/image.png'));

    expect(mockImg.onload).not.toBeNull();
    expect(mockImg.onerror).not.toBeNull();

    unmount();

    expect(mockImg.onload).toBeNull();
    expect(mockImg.onerror).toBeNull();
  });
  it('returns null while a new url loads, never the previous image (#1587)', () => {
    const images: any[] = [];
    window.Image = class {
      onload: any;
      onerror: any;
      src = '';
      complete = false;
      naturalHeight = 0;
      constructor() {
        images.push(this);
      }
    } as any;

    const { result, rerender } = renderHook(({ url }) => useImage(url), { initialProps: { url: 'http://example.com/a.png' } });
    act(() => {
      images[0].onload();
    });
    expect(result.current).toBe(images[0]);

    rerender({ url: 'http://example.com/b.png' });
    expect(result.current).toBeNull();
    // The abandoned request can no longer set state.
    expect(images[0].onload).toBeNull();

    act(() => {
      images[1].onload();
    });
    expect(result.current).toBe(images[1]);
  });
});
