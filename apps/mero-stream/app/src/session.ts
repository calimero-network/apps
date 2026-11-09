import { createContext, useContext } from "react";
import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./lib/meroStream";
import { pendingInvite } from "./lib/streams";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-stream";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Stream",
  description: "Experimental: streaming media over Calimero.",
  package: PACKAGE,
  dir: "mero-stream",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite token: a sign-up from a page holding one joins its org in
 * the same step.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE,
    invite: () => pendingInvite()?.token ?? null,
    // A sign-up from a page holding the invite joins its org in that step:
    // nothing is left to redeem (a second redeem would spend another use).
    // `InvitationPrompt` sees `api.joinedInvite`, drops the invite and opens
    // what the link named.
    onJoinedAtSignUp: () => {},
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
