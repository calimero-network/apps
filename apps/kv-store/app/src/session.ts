import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { PACKAGE } from "./kvStore";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "kv-store";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: "KV Store",
  description: "The reference Calimero app: a string key-value store, from contract to frontend.",
  package: PACKAGE,
  dir: "kv-store",
  dev: import.meta.env.DEV,
};

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app.
 * `invite` is the pending invite token: on an invite-only cluster it is what
 * lets a new person create an account.
 */
export function useSession(deps: SessionDeps = defaultDeps, invite?: () => string | null): SessionApi {
  return usePasskeySession(APP, deps, { package: PACKAGE, ...(invite ? { invite } : {}) });
}
