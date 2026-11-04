import { passkeyDeps, usePasskeySession, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-forms";

export const defaultDeps: SessionDeps = passkeyDeps(import.meta.env);

/** The shared passkey session (`@calimero-apps/passkey`) for this app. */
export function useSession(deps: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, deps);
}
