import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./calendar";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-calendar";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Calendar",
  description: "Shared team calendars, private events and booking links on Calimero.",
  package: PACKAGE,
  dir: "mero-calendar",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invite` is the pending invite token: on an invite-only cluster it is what
 * lets a new person create an account.
 */
export function useSession(
  deps: SessionDeps = defaultDeps,
  invite?: () => string | null,
  onJoined?: () => void,
): SessionApi {
  return usePasskeySession(APP, deps, {
    package: PACKAGE,
    ...(invite ? { invite } : {}),
    // A sign-up from a page holding the invite joined its org in that step:
    // `onJoined` drops it, so nothing is redeemed twice.
    ...(onJoined ? { onJoinedAtSignUp: onJoined } : {}),
  });
}
