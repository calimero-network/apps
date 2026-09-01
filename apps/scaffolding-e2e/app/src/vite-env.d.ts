/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ID: string;
  readonly VITE_APPLICATION_PACKAGE: string;
  readonly VITE_NODE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
