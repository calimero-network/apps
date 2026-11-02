// The connection every section calls through: the signed-in mero-js
// `CalimeroClient` and the app instance (v1: the context) it is pointed at.
//
// A module-level binding on purpose. The sections were written against v1's
// module-level node URL and context id, and keeping one place that holds "the
// current client and instance" is what lets every section stay unchanged: only
// `App.tsx` sets it, when the session or the opened instance changes.

import type { CalimeroClient } from "@calimero-network/mero-js";

export interface Connection {
  client: CalimeroClient;
  /** The app instance the sections call (`client.call(appId, …)`). */
  appId: string;
  /** The instance's organization, when it has one (invites, members). */
  org: string | null;
  /** The signed-in account. */
  accountId: string;
  /** Run after every request: keeps the stored session's refresh token current. */
  after: () => void;
}

let current: Connection | null = null;

export function setConnection(next: Connection | null): void {
  current = next;
}

export function getConnection(): Connection | null {
  return current;
}

/** The current instance id, or null when none is open. */
export function getContextId(): string | null {
  return current?.appId ?? null;
}
