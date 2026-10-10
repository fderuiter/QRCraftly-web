/**
 * Entry for `node --import ./scripts/utils/register-ts.js scripts/x.ts` (ADR 0045).
 * Registers the extensionless-import resolve hook in this thread before the script loads.
 */
import nodeModule from 'node:module';
import { resolve } from './ts-resolve.js';

if (typeof nodeModule.registerHooks !== 'function' || !process.features.typescript) {
  throw new Error(`TypeScript scripts need Node with type stripping and module.registerHooks (package.json engines); this is ${process.version}.`);
}
nodeModule.registerHooks({ resolve });
