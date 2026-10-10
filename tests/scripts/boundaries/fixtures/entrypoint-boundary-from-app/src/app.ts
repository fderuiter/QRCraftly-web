// Breaks the rule: app code reaches into a package's lib/.
import { impl } from '@/packages/alpha/lib/impl';

export const app = impl;
