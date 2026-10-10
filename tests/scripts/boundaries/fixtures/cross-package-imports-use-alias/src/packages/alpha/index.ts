// Breaks the rule: a relative path into another package's entry point.
import { beta } from '../beta/index';

export const alpha = beta;
