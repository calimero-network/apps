/**
 * The signed-in client. The session came from the served page (handoff.ts);
 * the node rotates its refresh token on every refresh (single use), so the
 * session is written back after every request, as packages/connect's
 * `SessionStore.sync` does on the page.
 */
import { createClient, policyFor as connectPolicy, type Target } from "@calimero-apps/connect";
import { AppError, CalimeroClient, LoginRequired, type NodePolicy } from "@calimero-network/mero-js";
import type { AuthState } from "./messages";
import { MeroSylenceClient } from "../generated/client";

/** The lowest mero-tee release a Cloud node may run (VITE_CALIMERO_MIN_RELEASE at build). */
export const MIN_RELEASE: string = (import.meta.env.VITE_CALIMERO_MIN_RELEASE as string | undefined) || "0.0.0";

/**
 * Where the session's nodes are: a development cluster (`merod local`, mock
 * TEEs) or Cloud nodes reached by URL (signed releases).
 */
export function targetFor(nodeUrl: string, nodes: string[] = []): Target {
  const host = new URL(nodeUrl).hostname;
  const all = [nodeUrl, ...nodes];
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return { kind: "local", nodes: all };
  return { kind: "cloud", cluster: host, direct: true, nodes: all, minReleaseVersion: MIN_RELEASE };
}

/** The trust policy for a node, decided by @calimero-apps/connect. */
export function policyFor(nodeUrl: string): NodePolicy {
  return connectPolicy(targetFor(nodeUrl));
}

export async function makeClient(
  auth: Pick<AuthState, "nodeUrl" | "nodes" | "session">,
  fetcher?: typeof fetch,
): Promise<CalimeroClient> {
  const client = await createClient(targetFor(auth.nodeUrl, auth.nodes), fetcher ? { fetch: fetcher } : {});
  client.useSession(auth.session);
  return client;
}

/**
 * Runs `work` with a client over `auth`, then saves the session the client
 * ends with (`save`), whether the work succeeded or not.
 */
export async function withClient<T>(
  auth: AuthState,
  save: (auth: AuthState) => Promise<void>,
  work: (client: CalimeroClient, app: MeroSylenceClient<CalimeroClient>) => Promise<T>,
  fetcher?: typeof fetch,
): Promise<T> {
  const client = await makeClient(auth, fetcher);
  const app = new MeroSylenceClient(client, auth.workspace?.appId ?? "");
  try {
    return await work(client, app);
  } finally {
    const now = client.session;
    if (now && JSON.stringify(now) !== JSON.stringify(auth.session)) {
      await save({ ...auth, session: now });
    }
  }
}

/** Whether the node said the session is over (sign in again). */
export function isSignedOut(e: unknown): boolean {
  return e instanceof LoginRequired;
}

/** A short sentence for an error, for the popup. */
export function describe(e: unknown): string {
  if (e instanceof LoginRequired) return "Your session ended. Sign in again.";
  if (e instanceof AppError) {
    const message = (e.fields as { message?: unknown }).message;
    return typeof message === "string" ? message : e.appCode;
  }
  if (e instanceof Error) {
    if (/412|CONFIRM_REQUIRED/.test(e.message)) return "This needs your passkey: do it on the Sylence page.";
    return e.message;
  }
  return String(e);
}
