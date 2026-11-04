import { passkeyDeps, usePasskeySession, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";
import { APP_NAME, APP_PACKAGE } from "./config";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/**
 * The shared passkey session (`@calimero-apps/passkey`) for this app. Replaces
 * mero-react's `MeroProvider` and node login.
 */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP_NAME, deps, { package: APP_PACKAGE });
}
