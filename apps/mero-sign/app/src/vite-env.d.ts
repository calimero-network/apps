/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPLICATION_ID?: string;
  readonly VITE_APPLICATION_PATH?: string;
  readonly VITE_CONTEXT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
