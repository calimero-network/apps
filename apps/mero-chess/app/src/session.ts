import { createContext, useContext } from "react";
import { passkeyDeps, usePasskeySession, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-chess";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** The shared passkey session (`@calimero-apps/passkey`) for this app. */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps);
}

/** The session `SessionProvider` (SessionProvider.tsx) holds, for every screen. */
export const SessionContext = createContext<SessionApi | null>(null);

/** The session the app was mounted with. */
export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi() outside <SessionProvider>");
  return api;
}
