// A cycle through a type-only import is not a cycle: types are erased.
import type { area } from './main';

export interface Shape {
  size: number;
  measure?: typeof area;
}
