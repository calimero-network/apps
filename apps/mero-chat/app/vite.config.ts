import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  // A bundle is served under /{version}/, so it builds relative; hosted at the root, deep links need an absolute base.
  base: process.env.RELATIVE_BASE ? "./" : "/",
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/e2e/**"],
    server: {
      deps: {
        // The platform SDK ships extensionless directory imports (e.g.
        // `export … from "./bridge"`) that Vite resolves but Node's raw ESM
        // loader rejects. Inline it so vitest transforms it through Vite.
        inline: [/@calimero-network\/mero-platform/],
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["curb-pwa.svg", "logo.svg", "section-name.svg"],
      manifest: {
        name: "Calimero Chat",
        short_name: "Calimero",
        description:
          "Calimero Chat is a P2P chat application built on top of the Calimero Network.",
        theme_color: "#f6f7fb",
        background_color: "#f6f7fb",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "./",
        start_url: "./",
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
