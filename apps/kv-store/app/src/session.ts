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

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.kv-store";

/** The app's name in stored keys. */
export const APP = "kv-store";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "KV Store",
  description: "The reference Calimero app: a string key-value store, from contract to frontend.",
  package: PACKAGE,
  dir: "kv-store",
  dev: import.meta.env.DEV,
};

/** The app's words and classes for the shared sign-in and invitation screens. */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
} = {
  appName: "KV Store",
  joining: "the shared store",
  listing: LISTING,
  classNames: { root: "card", text: "empty", control: "signin-control", error: "err", actions: "row", secondary: "ghost" },
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invites` is the app's pending-invite store: a sign-up from a page holding
 * one joins its org in the same step, `onJoined` is told which org (and the
 * whole pending invite), and the hook then drops it. The hook also binds the
 * store to the cluster and drops the invite on sign-out.
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
