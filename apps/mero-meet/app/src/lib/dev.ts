// ── Developer mode ────────────────────────────────────────────────────────────
//
// WebRTC is invisible plumbing for normal users — nothing about peers, signaling
// or ICE is ever shown in the UI. Developer mode is the *only* place any of it
// surfaces: a diagnostics overlay with the signaling log + per-peer connection
// stats.
//
// The source of truth is the **Calimero desktop app's developer-mode setting**
// (Settings → Developer mode). tauri-app forwards it to this window via the
// `dev_mode` URL-hash param (see appUtils `openAppFrontend`); we read it from
// the captured session. We also enable it under the Vite dev server for local
// development. We do NOT keep a separate per-app toggle.

import { isDeveloperMode } from "./session";

export function isDevMode(): boolean {
  return isDeveloperMode() || Boolean(import.meta.env.DEV);
}
