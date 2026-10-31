import {
  AppError,
  CalimeroClient,
  CalimeroError,
  ConfirmCancelled,
  DirectoryError,
  LoginRequired,
  TrapError,
  UnavailableError,
  type CalimeroSession,
} from "@calimero-network/mero-js";

import { policyFor, targetKey, type Target } from "./target";

export interface ClientOptions {
  /** Fetch for the directory, attestation and sealed requests (tests). */
  fetch?: typeof fetch;
}

/**
 * A `CalimeroClient` for `target`: the local nodes, failing over in order, or
 * the cloud cluster through the node directory, failing over across the nodes
 * it lists. Every node is attested under {@link policyFor} before anything is
 * sent to it.
 */
export async function createClient(target: Target, options: ClientOptions = {}): Promise<CalimeroClient> {
  const policy = policyFor(target);
  const fetcher = options.fetch ? { fetch: options.fetch } : {};
  if (target.kind === "local") {
    const [baseUrl, ...nodes] = target.nodes;
    if (!baseUrl) throw new Error("a local target needs at least one node");
    return new CalimeroClient({ baseUrl, nodes, policy, ...fetcher });
  }
  if (target.nodes && target.nodes.length > 0) {
    // Served by the cluster: its own list, same failover, no directory.
    const [baseUrl, ...nodes] = target.nodes;
    return new CalimeroClient({ baseUrl: baseUrl as string, nodes, policy, ...fetcher });
  }
  return CalimeroClient.connect({
    cluster: target.cluster,
    policy,
    ...(target.zone ? { zone: target.zone } : {}),
    ...(target.directory ? { directory: target.directory } : {}),
    ...fetcher,
  });
}

/** The `Storage` methods the session store uses (`localStorage` in a browser). */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isSession(value: unknown): value is CalimeroSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    typeof v.sessionToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.expiresAt === "number"
  );
}

/**
 * The signed-in session, kept per app and per target, so a dev session never
 * reaches a cloud cluster and two apps on one origin do not share one.
 *
 * The refresh token is single-use: the client swaps it on a `401` and holds
 * the new session, so call {@link SessionStore.sync} after requests (or let
 * {@link SessionStore.watch} do it) to keep the stored copy current. A stale
 * copy only costs a sign-in on the next load.
 */
export class SessionStore {
  readonly key: string;
  private last: string | null = null;

  constructor(
    app: string,
    target: Target,
    private readonly storage: KeyValueStorage | undefined = globalThis.localStorage,
  ) {
    this.key = `calimero-session:${app}:${targetKey(target)}`;
  }

  load(): CalimeroSession | null {
    try {
      const raw = this.storage?.getItem(this.key) ?? null;
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isSession(parsed)) {
        this.clear();
        return null;
      }
      this.last = raw;
      return parsed;
    } catch {
      return null;
    }
  }

  save(session: CalimeroSession): void {
    const raw = JSON.stringify(session);
    if (raw === this.last) return;
    this.last = raw;
    try {
      this.storage?.setItem(this.key, raw);
    } catch {
      // Storage full or blocked (private mode): the session lives for this page only.
    }
  }

  clear(): void {
    this.last = null;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* nothing stored */
    }
  }

  /** Stores the client's session if it has one and it changed. */
  sync(client: Pick<CalimeroClient, "session">): void {
    const session = client.session;
    if (session) this.save(session);
  }

  /** Puts a stored session on `client`; `true` when there was one. */
  restore(client: Pick<CalimeroClient, "useSession">): boolean {
    const session = this.load();
    if (!session) return false;
    client.useSession(session);
    return true;
  }
}

/** A one-line, user-facing account of a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    const fields = Object.keys(error.fields).length ? ` ${JSON.stringify(error.fields)}` : "";
    return `${error.appCode}${fields}`;
  }
  if (error instanceof TrapError) return `the app aborted the call (${error.kind || "trap"})`;
  if (error instanceof LoginRequired) return "Sign in first.";
  if (error instanceof ConfirmCancelled) return "The passkey prompt was cancelled.";
  if (error instanceof UnavailableError) return "The cluster is unavailable; try again shortly.";
  if (error instanceof DirectoryError) return `No node of the cluster could be found: ${error.message}`;
  if (error instanceof CalimeroError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
