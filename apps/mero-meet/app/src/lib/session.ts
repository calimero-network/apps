// ── Session bootstrap ─────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with auth + routing context in
// the URL hash (see tauri-app appUtils.ts `openAppFrontend`):
//
//   meromeet://…#node_url=…&access_token=…&refresh_token=…
//                &application_id=…&context_id=…&executor_public_key=…&expires_at=…
//
// A Mero Meet "room" == one Calimero context. The context_id tells us which
// room to open; the executor_public_key is our own member identity inside it.
// We capture both before React mounts and keep them for the app's lifetime.

let contextId: string | null = null;
let executorPublicKey: string | null = null;
let devMode = false;

export function captureSessionFromHash(): void {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const p = new URLSearchParams(hash);
  contextId = p.get("context_id") ?? p.get("contextId") ?? null;
  executorPublicKey =
    p.get("executor_public_key") ?? p.get("executorPublicKey") ?? null;
  // The desktop app forwards its developer-mode setting here.
  devMode = p.get("dev_mode") === "1";
}

/** Developer mode as set in the Calimero desktop app's settings. */
export function isDeveloperMode(): boolean {
  return devMode;
}

export function getContextId(): string | null {
  return contextId;
}

export function getExecutorPublicKey(): string | null {
  return executorPublicKey;
}

export function setSession(ctx: string, executor: string): void {
  contextId = ctx;
  executorPublicKey = executor;
}

/** Unix seconds — the clock the contract expects (WASM has no wall clock). */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
