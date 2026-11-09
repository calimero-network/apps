import { createContext, useContext } from "react";
import type { InviteStore, PendingInvite } from "@calimero-apps/connect";
import {
  type JoinedAtSignUp,
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
 * `invites` is the app's pending-invite store: a sign-up from a page holding
 * one joins its org in the same step, `onJoined` is told which org (and the
 * whole pending invite, with the arena its link names), and the hook then
 * drops it. The hook also binds the store to the cluster and drops the invite
 * on sign-out.
 */
export function useSession(
  deps: SessionDeps = defaultDeps,
  invites?: InviteStore,
  onJoined?: (joined: JoinedAtSignUp, pending: PendingInvite | null) => void,
): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE,
    ...(invites ? { invites } : {}),
    ...(onJoined ? { onJoinedAtSignUp: onJoined } : {}),
  });
}

/** Where an invitation lands once it is redeemed: its org, and the arena its link named. */
export interface InviteLanding {
  org: string | null;
  arena: string | null;
}

/** The pending-invite store, and where a join lands, for every screen (`SessionProvider`). */
export interface InviteState {
  invites: InviteStore;
  landing: InviteLanding | null;
  setLanding: (landing: InviteLanding | null) => void;
}

export const InviteContext = createContext<InviteState | null>(null);

/** The invite state the app was mounted with. */
export function useInviteState(): InviteState {
  const state = useContext(InviteContext);
  if (!state) throw new Error("useInviteState() outside <SessionProvider>");
  return state;
}

/** The session `SessionProvider` (SessionProvider.tsx) holds, for every screen. */
export const SessionContext = createContext<SessionApi | null>(null);

/** The session the app was mounted with. */
export function useSessionApi(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSessionApi() outside <SessionProvider>");
  return api;
}
