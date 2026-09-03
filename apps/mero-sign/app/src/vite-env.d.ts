/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PACKAGE_NAME?: string;
  readonly VITE_REGISTRY_URL?: string;
  // Still read by nodeApiDataSource's createContext FALLBACK, which throws when
  // it is unset — correct now that nothing bakes a default.
  readonly VITE_APPLICATION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
