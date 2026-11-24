import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type OnboardingClassNames,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";

export type { SessionApi, SessionDeps } from "@calimero-apps/passkey";

/** The package the iOS app creates its spaces from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-tag";

/** The app's name in stored keys. */
export const APP = "mero-tag";

export const APP_NAME = "Mero Tag";

/** Where the iOS app takes its session back after a sign-in here. */
export const SIGN_IN_CALLBACK = "mero-tag://signed-in";
/** Where the iOS app takes a passkey approval back. */
export const APPROVE_CALLBACK = "mero-tag://approved";
/** Where the iOS app takes the node's consent page decision back. */
export const CONSENT_CALLBACK = "mero-tag://consent";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What the listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: APP_NAME,
  description: "Live location sharing for your organization, as an iPhone app.",
  package: PACKAGE,
  dir: APP,
  dev: import.meta.env.DEV,
};

/** The app's words and classes for the shared sign-in screen. */
export const ONBOARDING: {
  appName: string;
  joining: string;
  listing: ListingProps;
  classNames: OnboardingClassNames;
} = {
  appName: APP_NAME,
  joining: "the space",
  listing: LISTING,
  classNames: { text: "dim", control: "signin-control", error: "err" },
};

/** The shared passkey session (`@calimero-apps/passkey`) for this page. */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  // No upgrade card: updates are approved in the iOS app.
  return usePasskeySession(APP, deps, { package: PACKAGE, upgradePrompt: false });
}
