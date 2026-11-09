import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { APP_NAME, APP_PACKAGE } from "./config";
import { pendingInvite } from "./companies";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "Mero Updates",
  description: "Investor updates without the platform, between a company's team and its investors.",
  package: APP_PACKAGE,
  dir: "mero-updates",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app. Replaces
 * mero-react's `MeroProvider` and node login. It carries the pending invite
 * token: on an invite-only cluster it lets a new person sign up.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP_NAME, deps, { package: APP_PACKAGE, invite: () => pendingInvite()?.token ?? null });
}
