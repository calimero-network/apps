/**
 * The extension's manifest, written into dist/ by the build (vite.config.ts).
 *
 * Permissions, each for one reason:
 * - `tabCapture`: record the meeting tab's audio (after the person opens the popup on it);
 * - `offscreen`: a page that may hold media streams and play the call back;
 * - `activeTab`, `tabs`: the meeting tab's address and title, for the meeting's name and platform;
 * - `storage`: settings, the session and transcript lines waiting to be saved;
 * - `identity`: `launchWebAuthFlow`, the sign-in window;
 * - `sidePanel`: the live transcript beside the call.
 * Hosts: Calimero's nodes (the workspace's API), and a local development cluster.
 * Model files come from Hugging Face over CORS, so it needs no host permission.
 */
export const ICON_SIZES = [16, 32, 48, 128] as const;

export function buildManifest(options: { key: string; version: string }): chrome.runtime.ManifestV3 {
  const icons = Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]));
  return {
    manifest_version: 3,
    name: "Minutes — meeting transcripts",
    short_name: "Minutes",
    version: options.version,
    description:
      "Transcribe Google Meet, Zoom and Teams calls on your own laptop and save the transcript to your Calimero workspace.",
    key: options.key,
    minimum_chrome_version: "116",
    icons,
    action: { default_title: "Minutes", default_popup: "popup.html", default_icon: icons },
    background: { service_worker: "background.js", type: "module" },
    side_panel: { default_path: "sidepanel.html" },
    permissions: ["tabCapture", "offscreen", "activeTab", "tabs", "storage", "identity", "sidePanel"],
    host_permissions: ["https://*.calimero.network/*", "http://localhost/*", "http://127.0.0.1/*"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // No cross-origin isolation (COEP/COOP): Chromium refuses to open a tab's
    // stream in an isolated offscreen page ("Error starting tab capture"). The
    // speech model then runs one CPU thread, or on WebGPU.
  } as chrome.runtime.ManifestV3;
}
