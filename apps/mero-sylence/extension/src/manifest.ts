/**
 * The extension's manifest, written into dist/ by the build (vite.config.ts).
 *
 * Permissions, each for one reason:
 * - `tabCapture`: record the meeting tab's audio (after the person opens the popup on it);
 * - `offscreen`: a page that may hold media streams and play the call back;
 * - `activeTab`, `tabs`: the meeting tab's address and title, for the meeting's name and platform;
 * - `storage`: settings, the session and transcript lines waiting to be saved;
 * - `sidePanel`: the live transcript beside the call;
 * - `scripting`: on Record, read who is talking from the call tab (speaker
 *   names). It runs only on the tab the person recorded, through the popup's
 *   activeTab grant, so it needs no host permission for the call sites.
 * Hosts: Calimero's nodes (the workspace's API), and a local development cluster.
 * `externally_connectable`: Sylence's page (Calimero's, or a local one in a
 * development build) may ask the extension for its session while it creates a
 * workspace the person asked for here, so they don't sign in twice. The
 * service worker answers only the page it opened, once (background: lending).
 * Model files come from Hugging Face over CORS, so it needs no host permission.
 */
export const ICON_SIZES = [16, 32, 48, 128] as const;

/** Hosts for a local development cluster: only in a development build (`store: false`). */
export const DEV_HOSTS = ["http://localhost/*", "http://127.0.0.1/*"];

/**
 * The call sites, as hosts: only in the fake-call test build (`e2e: true`,
 * `pnpm e2e:call`), where automation can't click the toolbar to give the
 * speaker reader its activeTab grant. Never in a store build.
 */
export const CALL_HOSTS = ["https://meet.google.com/*", "https://*.zoom.us/*", "https://teams.microsoft.com/*", "https://teams.live.com/*"];

export function buildManifest(options: { key: string; version: string; store?: boolean; e2e?: boolean }): chrome.runtime.ManifestV3 {
  const icons = Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]));
  return {
    manifest_version: 3,
    name: "Sylence — meeting transcripts",
    short_name: "Sylence",
    version: options.version,
    description:
      "Transcribe Google Meet, Zoom and Teams calls on your own laptop and save the transcript to your Calimero workspace.",
    key: options.key,
    minimum_chrome_version: "116",
    icons,
    action: { default_title: "Sylence", default_popup: "popup.html", default_icon: icons },
    background: { service_worker: "background.js", type: "module" },
    side_panel: { default_path: "sidepanel.html" },
    permissions: ["tabCapture", "offscreen", "activeTab", "tabs", "storage", "sidePanel", "scripting"],
    host_permissions: [
      "https://*.calimero.network/*",
      ...(options.store ? [] : DEV_HOSTS),
      ...(options.e2e && !options.store ? CALL_HOSTS : []),
    ],
    externally_connectable: {
      matches: ["https://*.calimero.network/*", ...(options.store ? [] : DEV_HOSTS)],
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // No cross-origin isolation (COEP/COOP): Chromium refuses to open a tab's
    // stream in an isolated offscreen page ("Error starting tab capture"). The
    // speech model then runs one CPU thread, or on WebGPU.
  } as chrome.runtime.ManifestV3;
}
