import {
  passkeyDeps,
  usePasskeySession,
  type PasskeySessionOptions,
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
