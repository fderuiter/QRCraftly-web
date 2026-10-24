import { generateMaze } from './lib/maze';
import { assertMazeWorkerRequest, assertMazeWorkerResponse, type MazeWorkerResponse } from './lib/mazeContract';
import type { QRModules } from '@/packages/core/types';

let latestSequenceId = -1;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

self.onmessage = async (e: MessageEvent<unknown>) => {
  let sequenceId: number | undefined;
  try {
    const data = e.data;
    if (data && typeof data === 'object') {
      const candidate = (data as Record<string, unknown>).sequenceId;
      sequenceId = typeof candidate === 'number' ? candidate : undefined;
    }

    if (typeof sequenceId === 'number' && sequenceId > latestSequenceId) {
      latestSequenceId = sequenceId;
    }

    // Yield immediately to let any incoming messages override this request
    await yieldToEventLoop();

    if (sequenceId !== undefined && sequenceId < latestSequenceId) {
      return; // Abort obsolete computation immediately
    }

    // Strictly validate incoming message at runtime
    assertMazeWorkerRequest(data);

    const { size, matrix, config } = data;

    // Reconstruct QRModules interface for the generator
    const modules: QRModules = {
      size,
      get(r: number, c: number) {
        return matrix[r * size + c] === 1;
      },
    };

    if (sequenceId !== undefined && sequenceId < latestSequenceId) {
      return; // Check again before running heavy CPU task
    }

    // Compute maze and A* pathfinding
    const mazeData = generateMaze(modules, config, size);

    if (sequenceId !== undefined && sequenceId < latestSequenceId) {
      return; // Check again after running heavy CPU task
    }

    // Construct response
    const response: MazeWorkerResponse = {
      status: 'success',
      sequenceId: sequenceId ?? -1,
      mazeData,
    };

    // Strictly validate outgoing message
    assertMazeWorkerResponse(response);

    self.postMessage(response);
  } catch (error) {
    if (sequenceId !== undefined && sequenceId < latestSequenceId) {
      return; // Quietly ignore obsolete request errors
    }

    const response: MazeWorkerResponse = {
      status: 'error',
      sequenceId: sequenceId ?? -1,
      error: (error instanceof Error && error.message) || 'MAZE_GENERATION_FAILED',
    };

    try {
      assertMazeWorkerResponse(response);
      self.postMessage(response);
    } catch {
      self.postMessage({
        status: 'error',
        sequenceId: sequenceId ?? -1,
        error: (error instanceof Error && error.message) || 'MAZE_GENERATION_FAILED',
      });
    }
  }
};
