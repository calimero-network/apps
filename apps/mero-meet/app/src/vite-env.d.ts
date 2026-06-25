/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPLICATION_PACKAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
