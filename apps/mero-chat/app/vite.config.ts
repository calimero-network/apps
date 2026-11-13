import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { servedAssetsFallback } from "@calimero-apps/node-served/vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "jsdom",
    globals: true,
    // First, so it runs before anything imports Testing Library: CI's longer
    // findBy*/waitFor wait (packages/test-setup).
    setupFiles: ["@calimero-apps/test-setup", "./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  server: {
    // 5173 exactly: the origin `merod local` trusts passkey ceremonies from
    // (`pnpm dev:local mero-chat` passes it too). `strictPort` so a busy port
    // fails instead of silently moving to an origin no passkey works on.
    port: 5173,
    strictPort: true,
  },
  plugins: [
    servedAssetsFallback(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["favicon.svg", "logo.svg", "apple-touch-icon.png", "og-image.png"],
      manifest: {
        // Root-relative on purpose. A node serves each release under
        // /{version}/ and redirects / to the latest, so "./" would tie an
        // installed app to the release it was installed from: a new app per
        // release, broken once that release is gone. On a root-hosted web
        // deploy "/" and "./" are the same.
        id: "/",
        name: "Hyperfeed Chat",
        short_name: "Hyperfeed Chat",
        description:
          "Private team chat: channels, threads and direct messages only your team can read.",
        theme_color: "#f6f7fb",
        background_color: "#f6f7fb",
        display: "standalone",
        categories: ["social", "communication", "productivity"],
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icons/icon-72x72.png",
            sizes: "72x72",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-96x96.png",
            sizes: "96x96",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-128x128.png",
            sizes: "128x128",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-144x144.png",
            sizes: "144x144",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-152x152.png",
            sizes: "152x152",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-384x384.png",
            sizes: "384x384",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // No HTML in the precache, and no precached navigation fallback. A
        // precached index.html is served before the network is asked, so the
        // first open after a deploy ran the previous build: an invite link
        // opened in the desktop landed on a screen that release had removed.
        // The page now comes from the network whenever there is one (Vercel
        // serves it `no-cache`), and pulls this build's hashed assets.
        globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
        navigateFallback: null,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Offline only: the last page the network served. Every route is
            // the same SPA shell, so they share one entry, whatever the path
            // or query (`?invitation=…` included).
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "app-shell",
              networkTimeoutSeconds: 5,
              plugins: [{ cacheKeyWillBeUsed: async () => "/index.html" }],
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 365 days
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
});
