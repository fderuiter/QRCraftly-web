/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

/** Options for the File System Access API save picker. */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface Window {
  /** File System Access API save picker (Chromium only); not yet in TypeScript's DOM lib. */
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

// Custom Vike setting declared in `src/pages/+config.ts` (`meta.imageAlt`).
declare namespace Vike {
  interface Config {
    /** Alternative text for the page's Open Graph image. */
    imageAlt?: string;
  }
  interface ConfigResolved {
    imageAlt?: string;
  }
}

/** Package version from package.json, replaced at build time (see `define` in vite.config.ts). */
declare const __APP_VERSION__: string;

/**
 * Foundry canary switch of the self-test module, from `FOUNDRY_SELFTEST` at build time (ADR 0033,
 * `foundryDefines` in scripts/utils/rustWorkspace.js). Each Rust module that replaces code gets one.
 */
declare const __FOUNDRY_SELFTEST__: 'wasm' | 'js';

/** Third-party packages that ship to the browser, generated at build time (see `scripts/vite/thirdPartyLicenses.ts`). */
declare module 'virtual:shipped-packages' {
  /** Site path of the full license texts. */
  export const licensesFile: string;
  const packages: readonly import('../scripts/vite/thirdPartyLicenses').ShippedPackageSummary[];
  export default packages;
}

/** The public docs rendered on the /security page, compiled at build time (see `scripts/vite/docsManifest.ts`). */
declare module 'virtual:docs-manifest' {
  const docs: readonly { id: string; filename: string; title: string; html: string }[];
  export default docs;
}
