import {
  passkeyDeps,
  usePasskeySession,
  type ListingProps,
  type SessionApi,
  type SessionDeps,
} from "@calimero-apps/passkey";
import { pendingNativeSignIn } from "@calimero-apps/passkey/native";
import { invites, inviteWorkspace } from "./lib/orgs";
import type { ActiveWorkspace } from "./lib/workspaceStore";
import { memoryStorage } from "./native";

export { describeTarget, type Session, type SessionApi, type SessionDeps } from "@calimero-apps/passkey";

/** The app's name in stored keys. */
export const APP = "mero-minutes";

/** The app's package in the registry. */
export const APP_PACKAGE = "com.calimero.mero-minutes";

/** The product's name, as every screen says it. */
export const PRODUCT = "Minutes";

/**
 * The real deps. While the extension's sign-in is pending (`main.tsx` captured
 * `#native-sign-in` before this module ran), sessions live in memory only: the
 * page does not restore one it kept before, and does not keep the one it hands
 * the extension.
 */
function deps(): SessionDeps {
  const base = passkeyDeps(import.meta.env);
  let pending = false;
  try {
    pending = pendingNativeSignIn() !== null;
  } catch {
    /* no sessionStorage: nothing pending */
  }
  return pending ? { ...base, storage: memoryStorage() } : base;
}

export const defaultDeps: SessionDeps = deps();

/** What this app's listing page (`<AppListing>`) shows on a copy no Calimero Cloud cluster serves. */
export const LISTING: ListingProps = {
  name: PRODUCT,
  description: "Transcribe your calls with a browser extension and keep the transcript and action items in your workspace.",
  package: APP_PACKAGE,
  dir: "mero-minutes",
  dev: import.meta.env.DEV,
};

let joinedAtSignUp: { workspace: ActiveWorkspace | null } | null = null;

/** What a sign-up that just joined with the invite should open, once; `null` when none did. */
export function takeJoinedAtSignUp(): { workspace: ActiveWorkspace | null } | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined;
}

/** The shared passkey session (`@calimero-apps/passkey`) for this app, with the pending invite. */
export function useSession(d: SessionDeps = defaultDeps): SessionApi {
  return usePasskeySession(APP, d, {
    package: APP_PACKAGE,
    invites,
    appName: PRODUCT,
    onJoinedAtSignUp: ({ org }, pending) => {
      const workspace = inviteWorkspace(pending);
      joinedAtSignUp = { workspace: workspace ? { appId: workspace, org: org ?? pending?.org ?? null } : null };
    },
  });
}
