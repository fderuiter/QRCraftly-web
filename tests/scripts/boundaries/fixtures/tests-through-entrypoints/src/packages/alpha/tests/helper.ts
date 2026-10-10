// Breaks the rule: a package's tests import its own lib/ instead of the entry point.
import { impl } from '../lib/impl';

export const helper = impl;
