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

/** The app's name in stored keys. */
export const APP = "scaffolding-e2e";

/** The app's package in the registry. */
export const PACKAGE = "com.calimero.scaffolding-e2e";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Scaffolding E2E",
  description: "The Calimero full-stack scaffold, with an interactive test suite.",
  package: PACKAGE,
  dir: "scaffolding-e2e",
  dev: import.meta.env.DEV,
};

/** The app's words and classes for the shared sign-in and invitation screens. */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
} = {
  appName: "the E2E test suite",
  joining: "the shared instance",
  listing: LISTING,
  classNames: { root: "method-card", title: "method-name", text: "method-hint", control: "signin-control", error: "result-box error", actions: "invitation-actions", primary: "btn-calimero", secondary: "btn-calimero-outline" },
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
