import {
  type OnboardingClassNames,
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { APP_NAME, APP_PACKAGE } from "./config";
import { inviteRoute, invites } from "./workspaces";
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
 * Where a sign-up that joined with the invite goes next: the route its link
 * named. Set before the session is signed in; `InvitationHost` (inside the
 * router, which this hook is not) takes it once it is.
 */
let joinedLanding: string | null = null;

/** The route a sign-up that joined with the invite should open, once; `null` for none. */
export function takeJoinedLanding(): string | null {
  const route = joinedLanding;
  joinedLanding = null;
  return route;
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
    // Open the workspace, on the page the link pointed at.
    onJoinedAtSignUp: ({ org }, pending) => {
      const joined = org ?? pending?.org ?? null;
      if (joined) announceJoined(joined);
      joinedLanding = inviteRoute(pending);
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
