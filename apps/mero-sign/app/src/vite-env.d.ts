/// <reference types="vite/client" />

/** See `.env.example` and `@calimero-apps/connect`. */
interface ImportMetaEnv {
  readonly VITE_CALIMERO_TARGET?: string;
  readonly VITE_CALIMERO_NODES?: string;
  readonly VITE_CALIMERO_BUNDLE?: string;
  readonly VITE_CALIMERO_CLUSTER?: string;
  readonly VITE_CALIMERO_MIN_RELEASE?: string;
  readonly VITE_CALIMERO_ZONE?: string;
  readonly VITE_CALIMERO_DIRECTORY?: string;
  readonly VITE_CALIMERO_PACKAGE?: string;
  readonly VITE_CALIMERO_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
