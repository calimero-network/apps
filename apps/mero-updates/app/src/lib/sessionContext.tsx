import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { appSource, type AppSource, type Target } from "@calimero-apps/connect";

import { APP_PACKAGE } from "./config";
import { defaultDeps, useSession, type SessionApi, type SessionDeps } from "./session";

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where instances come from: the dev bundle, or the package in production. */
  source: AppSource;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Connects once and shares the session with every screen. */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps);
  const source = useMemo(() => appSource(deps.env, APP_PACKAGE), [deps.env]);
  const value = useMemo(() => ({ api, deps, source }), [api, deps, source]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionApi(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSessionApi outside <SessionProvider>");
  return value;
}

/** What a signed-in screen needs. */
export interface SignedIn {
  client: CalimeroClient;
  accountId: string;
  target: Target;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Run after each request: keeps the stored session current (refresh tokens are single-use). */
  after: () => void;
}

/** The signed-in session, or null while there is none. */
export function useMaybeSignedIn(): SignedIn | null {
  const { api, deps, source } = useSessionApi();
  const { session, store } = api;
  const signedIn = session.status === "signed-in" ? session : null;
  const client = signedIn?.client ?? null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);
  return useMemo(
    () =>
      signedIn
        ? {
            client: signedIn.client,
            accountId: signedIn.accountId,
            target: signedIn.target,
            source,
            passkey: deps.passkey,
            after,
          }
        : null,
    [signedIn, source, deps.passkey, after],
  );
}

/** The signed-in session; only under the route guards, which render nothing until there is one. */
export function useSignedIn(): SignedIn {
  const value = useMaybeSignedIn();
  if (!value) throw new Error("useSignedIn without a session");
  return value;
}
