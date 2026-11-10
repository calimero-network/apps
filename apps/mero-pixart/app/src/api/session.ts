import {
  type OnboardingClassNames,
  passkeyDeps,
  usePasskeySession,
  type PasskeySessionOptions,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./pixart";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-pixart";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero PixArt",
  description: "A collaborative image editor with Photoshop-style layers, masks and adjustments.",
  package: PACKAGE,
  dir: "mero-pixart",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invites` is the pending invite (`createInviteStore`): on an invite-only
 * cluster its token is what lets a new person create an account, and the hook
 * drops it on sign-out, on a refusal and once a sign-up joined with it.
 */
export function useSession(
  deps: SessionDeps = defaultDeps,
  options: Pick<PasskeySessionOptions, "invites" | "onJoinedAtSignUp"> = {},
): SessionApi {
  return usePasskeySession(APP, deps, { package: PACKAGE, ...options });
}

/** The app's words and classes for the shared sign-in and invitation screens (`@calimero-apps/passkey`). */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
  titleAs: "h1" | "h2" | "h3" | "div";
} = {
  appName: "Mero PixArt",
  joining: "the team",
  listing: LISTING,
  classNames: { text: "sub", error: "sub" },
  titleAs: "h2",
};
