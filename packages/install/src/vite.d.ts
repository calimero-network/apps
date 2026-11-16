// The return type is deliberately not vite's `PluginOption`: an app resolves
// its own copy of vite (it differs by the app's @types/node), and a type from
// this package's copy would not be assignable to the app's.
export declare const installableApp: (options: {
  /** The app's id in kebab case: names its caches, so apps sharing an origin never collide. */
  cacheId: string;
  /** Extra scripts the service worker loads (hyperfeed's push handlers). */
  importScripts?: string[];
}) => any;
