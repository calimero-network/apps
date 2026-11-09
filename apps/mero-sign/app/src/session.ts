import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE_NAME } from "./constants/config";
import { pendingInvite } from "./lib/invites";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-sign";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Sign",
  description: "Document signing: upload a PDF, collect signatures from your organization, and keep every signed version.",
  package: PACKAGE_NAME,
  dir: "mero-sign",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite token: on an invite-only cluster it lets a new person sign up.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE_NAME,
    invite: () => pendingInvite()?.token ?? null,
    // No `onJoinedAtSignUp` yet: the invitation prompt keeps the invite it
    // read before the sign-up and redeems it after, so the token goes with a
    // sign-up only where the cluster requires one.
  });
}
