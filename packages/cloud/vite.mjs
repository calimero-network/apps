// A Content-Security-Policy for an app's production build, as a <meta> tag.
//
// The page holds a passkey session and talks to one cluster, so it should load
// code only from itself and send requests only to that cluster (and the package
// registry it installs from). A meta tag cannot carry `frame-ancestors`; the
// host should send that as a header.
//
// Only `vite build` gets it: the dev server injects inline scripts (React
// refresh) that a strict `script-src` refuses.

import { loadEnv } from 'vite';

const REGISTRY = 'https://apps.calimero.network';

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * @param {{ connect?: string[]; frame?: string[]; img?: string[]; style?: string[] }} [extra]
 *   Origins this app needs beyond its cluster and the registry.
 */
export function calimeroCsp(extra = {}) {
  let policy = '';
  return {
    name: 'calimero-csp',
    apply: 'build',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir ?? config.root, 'VITE_');
      const cluster = origin(env.VITE_CALIMERO_URL || 'http://127.0.0.1:2501');
      const fromEnv = (env.VITE_CALIMERO_CSP_CONNECT || '').split(/\s+/).filter(Boolean);
      const list = (...items) => [...new Set(items.flat().filter(Boolean))].join(' ');
      policy = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        // The apps run no eval; WebAssembly compiles in the page for some.
        "script-src 'self' 'wasm-unsafe-eval'",
        // React style props and the UI kit's injected <style> need inline styles.
        `style-src ${list("'self'", "'unsafe-inline'", extra.style ?? [])}`,
        `img-src ${list("'self'", 'data:', 'blob:', 'https:', extra.img ?? [])}`,
        "media-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        `frame-src ${list("'self'", 'blob:', extra.frame ?? [])}`,
        `connect-src ${list("'self'", cluster, REGISTRY, fromEnv, extra.connect ?? [])}`,
      ].join('; ');
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
    },
  };
}
