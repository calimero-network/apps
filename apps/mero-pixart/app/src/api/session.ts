import {
  passkeyDeps,
  usePasskeySession,
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
 * `invite` is the pending invite token: on an invite-only cluster it is what
 * lets a new person create an account.
 */
export function useSession(deps: SessionDeps = defaultDeps, invite?: () => string | null): SessionApi {
  return usePasskeySession(APP, deps, { package: PACKAGE, ...(invite ? { invite } : {}) });
}
