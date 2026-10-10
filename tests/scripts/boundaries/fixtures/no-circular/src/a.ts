// Breaks the rule: a -> b -> c -> a.
import { b } from './b';

export const a = () => b();
