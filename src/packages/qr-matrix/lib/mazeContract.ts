import type { QRConfig } from '@/packages/core/types';
import type { MazeData } from './maze';

export interface MazeWorkerRequest {
  size: number;
  matrix: Uint8Array;
  config: QRConfig;
  sequenceId: number;
}

export interface MazeWorkerResponse {
  status: 'success' | 'error';
  sequenceId: number;
  mazeData?: MazeData;
  error?: string;
}

/**
 * Type-guard function for validating the Maze Worker Request structure.
 */
export function isMazeWorkerRequest(data: unknown): data is MazeWorkerRequest {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.size !== 'number' || isNaN(d.size) || d.size <= 0) return false;
  if (!(d.matrix instanceof Uint8Array)) return false;
  if (typeof d.config !== 'object' || d.config === null) return false;
  if (typeof d.sequenceId !== 'number') return false;
  return true;
}

/**
 * Assertion function for Maze Worker Request.
 */
export function assertMazeWorkerRequest(data: unknown): asserts data is MazeWorkerRequest {
  if (!isMazeWorkerRequest(data)) {
    throw new Error('Invalid MazeWorkerRequest structure received by worker');
  }
}

/**
 * Type-guard function for validating the Maze Worker Response structure.
 */
export function isMazeWorkerResponse(data: unknown): data is MazeWorkerResponse {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.status !== 'success' && d.status !== 'error') return false;
  if (typeof d.sequenceId !== 'number') return false;
  if (d.mazeData !== undefined) {
    if (typeof d.mazeData !== 'object' || d.mazeData === null) return false;
    const maze = d.mazeData as Record<string, unknown>;
    if (!Array.isArray(maze.nodes)) return false;
    if (!Array.isArray(maze.edges)) return false;
    if (!Array.isArray(maze.solution)) return false;
  }
  if (d.error !== undefined && typeof d.error !== 'string') return false;
  return true;
}

/**
 * Assertion function for Maze Worker Response.
 */
export function assertMazeWorkerResponse(data: unknown): asserts data is MazeWorkerResponse {
  if (!isMazeWorkerResponse(data)) {
    throw new Error('Invalid MazeWorkerResponse structure received by host');
  }
}
