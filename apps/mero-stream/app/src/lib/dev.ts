// ── Developer mode ────────────────────────────────────────────────────────────
//
// Mero Stream is a diagnostic app end-to-end, but the raw metrics panel (live
// fragments, tombstone growth, compression ratio) is only meant to surface in
// developer mode.
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
