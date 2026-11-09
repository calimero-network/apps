import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { dropInvite, pendingInvite } from "./lib/orgs";
import { setActive } from "./lib/workspaceStore";

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
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite token: on an invite-only cluster it lets a new person sign up.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: APP_PACKAGE,
    invite: () => pendingInvite()?.token ?? null,
    // A sign-up from a page holding the invite joined its org in that step:
    // nothing is left to redeem (a second redeem would spend another use).
    onJoinedAtSignUp: ({ org }) => {
      const invite = pendingInvite();
      dropInvite();
      if (invite?.workspace) setActive({ appId: invite.workspace, org: org ?? invite.org });
    },
  });
}
