import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource } from "@calimero-apps/connect";

/**
 * The signed-in session, for the code outside React that talks to the cluster
 * (the data sources, blobs, names). `App` sets it once a session exists and
 * clears it on sign-out; nothing else knows a node URL or a token.
 *
 * v1 kept the same split: mero-react's MeroProvider held the client and
 * `getContextId()` named the open context. Here an app instance is v1's
 * context, and the account is the only identity (no per-context keys).
 */
export interface Connection {
  client: CalimeroClient;
  /** The signed-in account: the `sender`, `identity` and reactor every answer names. */
  accountId: string;
  /** Instances are created from this: the dev bundle, or the package in production. */
  source: AppSource;
  /** The browser's passkey, for the steps a node asks the account holder to approve. */
  passkey: () => PasskeyProvider;
  /** Runs after every request: keeps the stored session in step with a refresh. */
  after: () => void;
}

let current: Connection | null = null;
let activeApp = "";
const listeners = new Set<() => void>();

export function setConnection(next: Connection | null): void {
  current = next;
  if (!next) activeApp = "";
  listeners.forEach((fn) => fn());
}

/** The connection; throws before sign-in, which no screen that calls reaches. */
export function connection(): Connection {
  if (!current) throw new Error("Not signed in.");
  return current;
}

export function maybeConnection(): Connection | null {
  return current;
}

/** The signed-in account, or `""` before sign-in. */
export function selfAccount(): string {
  return current?.accountId ?? "";
}

/** The open conversation (app instance): v1's `getContextId()`. */
export function getActiveApp(): string {
  return activeApp;
}

export function setActiveApp(app: string): void {
  activeApp = app;
}

export function onConnectionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
