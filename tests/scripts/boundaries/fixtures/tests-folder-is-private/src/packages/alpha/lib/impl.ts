// Breaks the rule: implementation code imports a tests/ fixture.
import { fixture } from '../tests/fixture';

export const impl = fixture;
