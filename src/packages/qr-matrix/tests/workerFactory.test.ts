/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMatrixWorker, createMazeWorker } from '../index';

class RecordingWorker {
  readonly url: URL | string;
  readonly options?: WorkerOptions;

  constructor(url: URL | string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
  }
}

describe('qr-matrix worker factories', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('return null where Web Workers are unavailable', () => {
    vi.stubGlobal('Worker', undefined);
    expect(createMatrixWorker()).toBeNull();
    expect(createMazeWorker()).toBeNull();
  });

  it('spawn the package-owned worker scripts as module workers', () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('Worker', RecordingWorker);

    const matrix = createMatrixWorker() as unknown as RecordingWorker;
    const maze = createMazeWorker() as unknown as RecordingWorker;

    expect(String(matrix.url)).toMatch(/\/packages\/qr-matrix\/worker-matrix\.ts$/);
    expect(String(maze.url)).toMatch(/\/packages\/qr-matrix\/worker-maze\.ts$/);
    expect(matrix.options).toEqual({ type: 'module' });
    expect(maze.options).toEqual({ type: 'module' });
  });
});
