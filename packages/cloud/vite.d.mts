/**
 * A Content-Security-Policy `<meta>` for the production build: the page's own
 * origin, the cluster (`VITE_CALIMERO_URL`) and the package registry, plus
 * `extra` origins. Typed without importing Vite, so an app's own Vite version
 * is the one that checks it.
 */
export declare function calimeroCsp(extra?: { connect?: string[]; frame?: string[]; img?: string[]; style?: string[] }): {
  name: string;
  apply: 'build';
  configResolved(config: { mode: string; root: string; envDir?: string | false }): void;
  transformIndexHtml(): Array<{ tag: string; attrs: Record<string, string>; injectTo: 'head-prepend' }>;
};
