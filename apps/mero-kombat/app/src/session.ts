import { createContext, useContext } from "react";
import {
  type OnboardingClassNames,
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./kombat";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-kombat";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Kombat",
  description: "A one-on-one arcade fighting game with no game server.",
  package: PACKAGE,
  dir: "mero-kombat",
  dev: import.meta.env.DEV,
};

/** The app's words and classes for the shared sign-in and invitation screens. */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
} = {
  appName: "Mero Kombat",
  joining: "the arena",
  listing: LISTING,
  classNames: { root: "card", text: "hint", error: "err", actions: "row", secondary: "ghost" },
};

/** The invitation page's classes: the connect card's look. */
export const INVITATION_PAGE_CLASSES: OnboardingClassNames = {
  root: "connect",
  inner: "connect-card",
  text: "lede",
  control: "connect-passkey",
  error: "err",
  actions: "row center",
  secondary: "ghost",
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invite` is the pending invite token. A sign-up from a page holding one
 * joins its org in the same step (`joinAtSignUp`); the app then sees
 * `api.joinedInvite` and opens what the invite was for.
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
