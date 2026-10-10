import type { Shape } from './shapes';
import { one } from '@/util';
import { one as uno } from './util';

export const load = () => import('./lazy');
export const area = (shape: Shape) => shape.size * one * uno;
