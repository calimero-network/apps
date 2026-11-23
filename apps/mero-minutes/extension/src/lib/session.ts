/**
 * The signed-in client. The session came from the served page (handoff.ts);
 * the node rotates its refresh token on every refresh (single use), so the
 * session is written back after every request, as packages/connect's
 * `SessionStore.sync` does on the page.
 */
import { AppError, CalimeroClient, LoginRequired, type NodePolicy } from "@calimero-network/mero-js";
import type { AuthState } from "./messages";
import { MeroMinutesClient } from "../generated/client";

/** The lowest mero-tee release a Cloud node may run (VITE_CALIMERO_MIN_RELEASE at build). */
export const MIN_RELEASE: string = (import.meta.env.VITE_CALIMERO_MIN_RELEASE as string | undefined) || "0.0.0";

/** A development cluster (`merod local`) runs mock TEEs; Cloud runs signed releases. */
export function policyFor(nodeUrl: string): NodePolicy {
  const host = new URL(nodeUrl).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  return local ? { allowMock: true } : { release: { minReleaseVersion: MIN_RELEASE } };
}

export function makeClient(auth: Pick<AuthState, "nodeUrl" | "nodes" | "session">, fetcher?: typeof fetch): CalimeroClient {
  const client = new CalimeroClient({
    baseUrl: auth.nodeUrl,
    nodes: auth.nodes,
    policy: policyFor(auth.nodeUrl),
    ...(fetcher ? { fetch: fetcher } : {}),
  });
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
  work: (client: CalimeroClient, app: MeroMinutesClient<CalimeroClient>) => Promise<T>,
  fetcher?: typeof fetch,
): Promise<T> {
  const client = makeClient(auth, fetcher);
  const app = new MeroMinutesClient(client, auth.workspace?.appId ?? "");
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
    if (/412|CONFIRM_REQUIRED/.test(e.message)) return "This needs your passkey: do it on the Minutes page.";
    return e.message;
  }
  return String(e);
}
