/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PACKAGE_NAME?: string;
  readonly VITE_REGISTRY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
