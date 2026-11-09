import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { appSource, targetKey, type AppSource, type Target } from "@calimero-apps/connect";

import { PACKAGE } from "./calendar";
import { setAccountId } from "./identity";
import { defaultDeps, useSession, type SessionApi, type SessionDeps } from "./session";
import { dropInvite, pendingInvite } from "./teams";

interface SessionValue {
  api: SessionApi;
  deps: SessionDeps;
  /** Where instances come from: the dev bundle, or the package in production. */
  source: AppSource;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Connects once (local nodes in dev, the Cloud cluster in production) and
 * shares the session with every screen. Replaces v1's `MeroProvider`.
 */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps, () => pendingInvite(), () => dropInvite());
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const value = useMemo(() => ({ api, deps, source }), [api, deps, source]);
  const account = api.session.status === "signed-in" ? api.session.accountId : "";
  useEffect(() => setAccountId(account), [account]);
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
  /** Keys what this browser remembers per cluster (last visit, names). */
  targetKey: string;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Run after each request: keeps the stored session current (refresh tokens are single-use). */
  after: () => void;
  signOut: () => Promise<void>;
}

/** The signed-in session; only under the route guard, which renders nothing until there is one. */
export function useSignedIn(): SignedIn {
  const { api, deps, source } = useSessionApi();
  const { session, store, signOut } = api;
  const signedIn = session.status === "signed-in" ? session : null;
  const client = signedIn?.client ?? null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [store, client]);
  const value = useMemo(
    () =>
      signedIn
        ? {
            client: signedIn.client,
            accountId: signedIn.accountId,
            target: signedIn.target,
            targetKey: targetKey(signedIn.target),
            source,
            passkey: deps.passkey,
            after,
            signOut,
          }
        : null,
    [signedIn, source, deps.passkey, after, signOut],
  );
  if (!value) throw new Error("useSignedIn without a session");
  return value;
}
