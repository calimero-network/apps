import { createContext, useContext } from "react";
import { passkeyDeps, usePasskeySession, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "hyperfeed";

/** The package production instances are created from (`VITE_CALIMERO_PACKAGE` overrides it). */
export const PACKAGE = "com.calimero.hyperfeed";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** The shared passkey session (`@calimero-apps/passkey`) for this app. */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, { package: PACKAGE });
}

/** The session for every screen: provided once in `main.tsx`. */
export const SessionContext = createContext<SessionApi | null>(null);

/** The session the app was mounted with. */
export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi outside <SessionContext.Provider>");
  return api;
}
