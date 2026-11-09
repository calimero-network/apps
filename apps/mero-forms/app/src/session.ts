import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { invites, inviteWorkspace } from "./lib/orgs";
import type { ActiveWorkspace } from "./lib/workspaceStore";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-forms";

/** The app's package in the registry. */
export const APP_PACKAGE = "com.calimero.mero-forms";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Forms",
  description: "Build forms, collect responses from your website or a public link, and send them to Mero CRM.",
  package: APP_PACKAGE,
  dir: "mero-forms",
  dev: import.meta.env.DEV,
};

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in: the workspace its link named (`null` for none).
 * `InvitationHost` takes it once signed in (the remembered workspace is kept
 * per account) and opens it.
 */
let joinedAtSignUp: { workspace: ActiveWorkspace | null } | null = null;

/** What a sign-up that just joined with the invite should open, once; `null` when none did. */
export function takeJoinedAtSignUp(): { workspace: ActiveWorkspace | null } | null {
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
    // nothing is left to redeem (that would spend another use). Open the
    // workspace the link named.
    onJoinedAtSignUp: ({ org }, pending) => {
      const workspace = inviteWorkspace(pending);
      joinedAtSignUp = { workspace: workspace ? { appId: workspace, org: org ?? pending?.org ?? null } : null };
    },
  });
}
