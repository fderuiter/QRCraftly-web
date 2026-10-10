// Breaks the rule: a package reaches into another package's lib/.
import { impl } from '@/packages/beta/lib/impl';

export const alpha = impl;
