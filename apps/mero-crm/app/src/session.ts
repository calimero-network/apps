import {
  type OnboardingClassNames,
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { APP_NAME, APP_PACKAGE } from "./config";
import { dropInvite, pendingInvite } from "./workspaces";
import { announceJoined } from "./hooks/workspacePersistence";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = APP_NAME;

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero CRM",
  description: "A simple, private sales CRM: track your pipeline, work your deals, and never lose a follow-up.",
  package: APP_PACKAGE,
  dir: "mero-crm",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app, with the
 * pending invite token: on an invite-only cluster it lets a new person sign up.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, {
    package: APP_PACKAGE,
    invite: () => pendingInvite(),
    // A sign-up from a page holding the invite joined its org in that step:
    // nothing is left to redeem (a second redeem would spend another use).
    onJoinedAtSignUp: ({ org }) => {
      dropInvite();
      if (org) announceJoined(org);
    },
  });
}

/** The app's words and classes for the shared sign-in and invitation screens (`@calimero-apps/passkey`). */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
  titleAs: "h1" | "h2" | "h3" | "div";
} = {
  appName: "Mero CRM",
  joining: "the workspace",
  listing: LISTING,
  classNames: { text: "sub", error: "sub" },
  titleAs: "h3",
};
