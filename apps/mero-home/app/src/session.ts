import type { InviteStore, PendingInvite } from "@calimero-apps/connect";
import {
  type JoinedAtSignUp,
  type ListingProps,
  type OnboardingClassNames,
  passkeyDeps,
  usePasskeySession,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";

import { PACKAGE } from "./home";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-home";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What Home's listing page shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Calimero Home",
  description: "One place for an organization: its apps, who is in each, and invitations.",
  package: PACKAGE,
  dir: "mero-home",
  dev: import.meta.env.DEV,
};

/** Home's words and classes for the shared sign-in and invitation screens. */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
  askName: boolean;
} = {
  appName: "Calimero Home",
  joining: "the organization",
  listing: LISTING,
  classNames: {
    root: "home-card",
    text: "home-muted",
    control: "home-signin",
    error: "home-error",
    actions: "home-row",
    secondary: "glass-btn",
  },
  // A new account gives an optional name, so People and Invitations show a
  // person rather than a key id.
  askName: true,
};

/** The shared passkey session for Home, joining a pending invite at sign-up. */
export function useSession(
  deps: SessionDeps = defaultDeps,
  invites?: InviteStore,
  onJoined?: (joined: JoinedAtSignUp, pending: PendingInvite | null) => void,
): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE,
    // The name asked at sign-up is the one People and Invitations show.
    nameJoinedOrg: true,
    ...(invites ? { invites } : {}),
    ...(onJoined ? { onJoinedAtSignUp: onJoined } : {}),
  });
}
