/// <reference types="vite/client" />

/** App version from package.json, injected by Vite's `define` at build time. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_APPLICATION_PACKAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
