import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { appSource, targetKey, type AppSource, type Target } from "@calimero-apps/connect";

import { bindScope } from "./lib/workspaceStore";
import { APP_PACKAGE, defaultDeps, useSession, type SessionApi, type SessionDeps } from "./session";

/** The package production instances are created from (`[package.metadata.calimero]`). */
export { APP_PACKAGE };

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where instances come from: the dev bundle, or the package in production. */
  source: AppSource;
}

const noSignOut = async () => {};
const NO_SOURCE: AppSource = { package: APP_PACKAGE };

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Connects once (local nodes in dev, the Cloud cluster in production) and
 * shares the session with every screen. Replaces v1's `MeroProvider`.
 */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps);
  const source = useMemo(() => appSource(deps.env, APP_PACKAGE), [deps.env]);
  // The remembered workspace is per cluster and per account; switched during
  // render, before any screen reads it.
  const scope =
    api.session.status === "signed-in" ? `${targetKey(api.session.target)}:${api.session.accountId}` : null;
  useMemo(() => bindScope(scope), [scope]);
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
  signOut: () => Promise<void>;
}

/**
 * The signed-in session, or null while there is none (or outside a
 * `SessionProvider`, as in a screen test that renders one card).
 */
export function useMaybeSignedIn(): SignedIn | null {
  const ctx = useContext(SessionContext);
  const api = ctx?.api;
  const deps = ctx?.deps ?? defaultDeps;
  const source = ctx?.source ?? NO_SOURCE;
  const session = api?.session ?? { status: "connecting" as const };
  const store = api?.store ?? null;
  const signOut = api?.signOut ?? noSignOut;
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
            signOut,
          }
        : null,
    [signedIn, source, deps.passkey, after, signOut],
  );
}

/** The signed-in session; only below the guards, which render nothing until there is one. */
export function useSignedIn(): SignedIn {
  const value = useMaybeSignedIn();
  if (!value) throw new Error("useSignedIn without a session");
  return value;
}
