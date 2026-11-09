import { createContext, useContext } from "react";
import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./battleships";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "battleships";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Battleships",
  description: "Two-player Battleships, with boards that stay on each player's device.",
  package: PACKAGE,
  dir: "battleships",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invite` is the pending invite token. With `joinAtSignUp`, a sign-up from a
 * page holding one joins its org in the same step; the app sees
 * `api.joinedInvite` and does not redeem it again.
 */
export function useSession(
  deps: SessionDeps = defaultDeps,
  invite?: () => string | null,
  joinAtSignUp = false,
): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE,
    ...(invite ? { invite } : {}),
    ...(joinAtSignUp ? { onJoinedAtSignUp: () => {} } : {}),
  });
}

/** The session `SessionProvider` (SessionProvider.tsx) holds, for every screen. */
export const SessionContext = createContext<SessionApi | null>(null);

/** The session the app was mounted with. */
export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi() outside <SessionProvider>");
  return api;
}
