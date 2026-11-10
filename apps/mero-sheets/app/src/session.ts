import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { APP_PACKAGE } from './config';
import { invites } from "./lib/workspaces";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-sheets";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Sheets",
  description: "A collaborative spreadsheet with live cursors, sheet tabs and formulas.",
  package: APP_PACKAGE,
  dir: "mero-sheets",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite token: a sign-up from a page holding one joins its org in
 * the same step.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: APP_PACKAGE,
    // The hook binds the pending invite to the cluster, and drops it on
    // sign-out, on a refusal and once a sign-up joined with it.
    invites,
    // A sign-up from a page holding the invite joins its org in that step:
    // nothing is left to redeem (a second redeem would spend another use).
    // `InvitationPrompt` still holds the invite it read, sees
    // `api.joinedInvite` and opens what it named.
    onJoinedAtSignUp: () => {},
  });
}
