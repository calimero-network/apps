import { createContext, useContext, useMemo, type ReactNode } from "react";
import { appSource, targetKey, type AppSource } from "@calimero-apps/connect";

import { bindApi, peekApi, type ApiBinding } from "./api/client";
import { APP_PACKAGE } from "./config";
import { defaultDeps, useSession, type SessionApi, type SessionDeps } from "./session";

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where boards come from: the dev bundle, or the package in production. */
  source: AppSource;
  /** The signed-in client as the plain-function data layer sees it (`api/client.ts`). */
  binding: ApiBinding | null;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Connects once (local nodes in dev, the Cloud cluster in production), shares
 * the session with every screen and binds its client for the data layer in
 * `src/api`. Replaces v1's `MeroProvider` and `ApiBinder`.
 */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps);
  const source = useMemo(() => appSource(deps.env, APP_PACKAGE), [deps.env]);
  const { session, store } = api;
  const signedIn = session.status === "signed-in" ? session : null;
  const binding = useMemo<ApiBinding | null>(() => {
    if (!signedIn) return null;
    const client = signedIn.client;
    return {
      client,
      accountId: signedIn.accountId,
      source,
      passkey: deps.passkey,
      after: () => store?.sync(client),
      scope: `${targetKey(signedIn.target)}:${signedIn.accountId}`,
    };
  }, [signedIn, source, deps.passkey, store]);
  // Bound during render, so a child's effect (which runs before this
  // component's own would) already finds the client.
  if (peekApi() !== binding) bindApi(binding);
  const value = useMemo(() => ({ api, deps, source, binding }), [api, deps, source, binding]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionApi(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSessionApi outside <SessionProvider>");
  return value;
}

/** What the screens asked v1's `useMero()` for: signed in or not, sign out, and where. */
export interface AuthState {
  isAuthenticated: boolean;
  /** Still connecting or restoring a stored session. */
  isLoading: boolean;
  logout: () => void;
  /**
   * The cluster and account this session is on. Takes the place of v1's node
   * URL wherever the app remembers something per session (`utils/lastVisit`).
   */
  nodeUrl: string;
  /** The signed-in account, or "". */
  accountId: string;
}

export function useAuth(): AuthState {
  const { api, binding } = useSessionApi();
  const status = api.session.status;
  const signOut = api.signOut;
  return useMemo(
    () => ({
      isAuthenticated: status === "signed-in",
      isLoading: status === "connecting",
      logout: () => void signOut(),
      nodeUrl: binding?.scope ?? "",
      accountId: binding?.accountId ?? "",
    }),
    [status, signOut, binding],
  );
}
