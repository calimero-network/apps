import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { APP_PACKAGE } from "./config";
import type { PendingInvite } from "@calimero-apps/connect";
import { invites } from "./lib/spaces";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-forum";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Forum",
  description: "A discussion forum: threads, comments, votes and moderation, shared by the members of your organization.",
  package: APP_PACKAGE,
  dir: "mero-forum",
  dev: import.meta.env.DEV,
};

/** What a sign-up that joined with the page's invite joined, and where its link pointed. */
export interface JoinedAtSignUp {
  org: string | null;
  invite: PendingInvite | null;
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in; `InvitationHost` (inside the router, which this hook is not)
 * takes it once signed in and opens what the link pointed at.
 */
let joinedAtSignUp: JoinedAtSignUp | null = null;

/** What a sign-up just joined with the invite, once; `null` when none did. */
export function takeJoinedAtSignUp(): JoinedAtSignUp | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined;
}

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite: on an invite-only cluster it lets a new person sign up, and
 * the hook drops it on sign-out, on a refusal and once a sign-up joined with it.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: APP_PACKAGE,
    invites,
    // A sign-up from a page holding the invite joined its org in that step:
    // nothing is left to redeem (a second redeem would spend another use).
    // The forum (and post) the link named opens once signed in.
    onJoinedAtSignUp: ({ org }, pending) => {
      joinedAtSignUp = { org: org ?? pending?.org ?? null, invite: pending };
    },
  });
}
