// The service worker every installable app ships. Plain JS: vite.config loads it with Node.
//
// It exists so the browser offers to install the app (Chrome and Edge only
// show their install prompt for a page whose service worker answers fetches),
// and so an installed app still opens offline. It must never run a stale build:
//
// - No HTML in the precache and no precached navigation fallback. The page
//   comes from the network whenever there is one, and pulls that build's
//   hashed assets; the cached copy is only for offline.
// - Every cache is named after the app (`cacheId`). Apps share an origin in
//   `vite preview` (and used to in production), so two apps' caches must not
//   collide or clean each other up.
// - The app's own manifest (public/site.webmanifest) is kept: the plugin
//   writes no manifest of its own.
import { VitePWA } from "vite-plugin-pwa";

export const installableApp = ({ cacheId, importScripts = [] }) => {
  if (!/^[a-z0-9-]+$/.test(cacheId ?? "")) {
    throw new Error(`installableApp: cacheId must be the app's id in kebab case (got ${JSON.stringify(cacheId)})`);
  }
  return VitePWA({
    manifest: false,
    injectRegister: false,
    registerType: "autoUpdate",
    filename: "sw.js",
    devOptions: { enabled: false },
    workbox: {
      cacheId,
      importScripts,
      globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
      // The landing images are large and the app works without them offline.
      globIgnores: ["**/landing/**", "**/screenshots/**"],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      navigateFallback: null,
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
      runtimeCaching: [
        {
          // Offline only: the last page the network served. Every route is the
          // same SPA shell, so they share one entry, whatever the path or query.
          urlPattern: ({ request }) => request.mode === "navigate",
          handler: "NetworkFirst",
          options: {
            cacheName: `${cacheId}-app-shell`,
            networkTimeoutSeconds: 5,
            plugins: [{ cacheKeyWillBeUsed: async () => "/index.html" }],
          },
        },
      ],
    },
  });
};
