import type { KeyValueStorage } from "@calimero-apps/connect";
import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type OnboardingClassNames,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";

export type { SessionApi, SessionDeps } from "@calimero-apps/passkey";

/** The package the cluster serves this page from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-ar";

/** The app's name in stored keys. */
export const APP = "mero-ar";

/** The app's name, as people know it. */
export const APP_NAME = "Mero AR";

/**
 * Where the iOS app receives what this page hands it (the URL scheme in
 * mobile/ios/project.yml): the session after a sign-in, a passkey approval,
 * and the node's consent page's answer.
 */
export const SIGNED_IN_CALLBACK = "mero-ar://signed-in";
export const APPROVED_CALLBACK = "mero-ar://approved";
export const CONSENT_CALLBACK = "mero-ar://consent";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What the listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: APP_NAME,
  description: "Collaborative spatial editing on your organization's Calimero cluster, in the Mero AR iPhone app.",
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
  joining: "the home",
  listing: LISTING,
  classNames: {
    root: "ar-panel",
    title: "ar-title",
    text: "ar-text",
    control: "ar-control",
    error: "ar-error",
    actions: "ar-actions",
  },
};

/**
 * Storage that lives as long as the page: a sign-in for the iOS app starts
 * fresh and leaves nothing behind in this browser, so the app holds the only
 * copy of its session.
 */
export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** The shared passkey session (`@calimero-apps/passkey`) for this page. */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps, { package: PACKAGE });
}
