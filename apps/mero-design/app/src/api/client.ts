import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";

// ── The session's client, reachable from plain functions ─────────────────────
//
// Everything this app says to the cluster goes through one mero-js
// `CalimeroClient`: contract calls and views, the org (team) and app instance
// (board) API, blobs and the event stream. Most of this app's calls are made
// from plain functions, not components (`rpcCall` is fired from fabric event
// handlers, the batch helpers, the project file importer), so the session
// provider publishes the signed-in client here once (`sessionContext.tsx`) and
// `getApi()` reads it back from anywhere. There is exactly one session per
// page, so one binding is the truth.

export interface ApiBinding {
  client: CalimeroClient;
  /** The signed-in account: what members, authors and owners are named by. */
  accountId: string;
  /** Where boards come from: the dev bundle, or the package in production. */
  source: AppSource;
  /** The browser's passkey, for the step-ups (invite, roles, delete a team). */
  passkey: () => PasskeyProvider;
  /** Run after each request: keeps the stored session current (refresh tokens are single-use). */
  after: () => void;
  /** This cluster and account, for keys this browser remembers per session. */
  scope: string;
}

let current: ApiBinding | null = null;

/** Publish the client a page's calls use. `null` on sign-out. */
export function bindApi(binding: ApiBinding | null): void {
  current = binding;
}

/** The bound client, or a clear error when nobody is signed in yet. */
export function getApi(): ApiBinding {
  if (!current) {
    throw new Error("Not signed in: no Calimero session is bound yet.");
  }
  return current;
}

/** The binding, when there is one: for callers that can wait for a session. */
export function peekApi(): ApiBinding | null {
  return current;
}
