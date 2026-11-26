// Vite's `import.meta.env`, which `cloud.ts` reads the build's Calimero Cloud
// from, for every program that compiles this package, with or without
// `vite/client`. `env` is declared exactly as `vite/client` declares it, so the
// two merge where both are present.
interface ImportMetaEnv {
  /** `production` (default) | `staging`: see `ConnectEnv`. */
  readonly VITE_CALIMERO_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
