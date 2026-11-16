import type { GroupApi } from "../api/groupApi";
import { setGroupId, setGroupMemberIdentity } from "../constants/config";
import { log } from "./logger";
import { setMessengerDisplayName } from "./messengerName";
import { ensureNotificationPermission } from "./notificationPermission";
import {
  clearNamespaceReady,
  clearStoredSession,
  setNamespaceReady,
} from "./session";
import { nodeBasename } from "./servedByNode";
import { landInGeneral } from "./landing";

// Every way into a workspace ends here: the picker (`NamespaceEntryPopup`),
// an accepted invitation (`InvitationPrompt`, `ConsentReturn`) and a new
// workspace (`finishWorkspace`).

/**
 * Commit the workspace, publish your name in it, and load the chat.
 *
 * Your name is the workspace's member metadata for your account, the one
 * place every channel, DM and message reads it from; nothing is written into
 * the conversations. It is written before the page reloads (a write still in
 * flight would be cut off by the navigation), unless `published` says the
 * workspace already holds it.
 */
export async function enterWorkspace(
  api: Pick<GroupApi, "setMemberMetadata">,
  namespaceId: string,
  username: string,
  memberIdentity: string,
  options: { published?: boolean } = {},
): Promise<void> {
  // Ask for OS notification permission once, here and first: entry is a real
  // user gesture (Safari requires one, and it does not outlive the awaits
  // below). Not awaited: entry must not block on the browser prompt.
  void ensureNotificationPermission();
  setGroupId(namespaceId);
  setMessengerDisplayName(username, namespaceId);
  if (memberIdentity) {
    setGroupMemberIdentity(namespaceId, memberIdentity);
    if (username && !options.published) {
      try {
        const res = await api.setMemberMetadata(namespaceId, memberIdentity, { name: username });
        if (res.error) log.warn("enterWorkspace", `could not publish member name: ${res.error.message}`);
      } catch (err) {
        log.warn("enterWorkspace", "could not publish member name", err);
      }
    }
  }
  // Open #general first: the person lands in a channel, not an empty screen.
  landInGeneral();
  forgetJoinedAwaitingName();
  clearStoredSession();
  setNamespaceReady(namespaceId);
  // Hard load, not navigate("/"). App.tsx gates "/" on
  //   canEnterApp = (isAuthenticated || hasLiveSession()) && isNamespaceReady()
  // which is read ONCE during render. A client-side navigate can land in the
  // window where that is still false (mero-react's `isAuthenticated` lags
  // after a fresh connect), and "/" then renders <Navigate to="/login"> —
  // bouncing straight back to this picker. Symptom: "Continue" appears to do
  // nothing and the user has to reload by hand, after which entry works
  // because the flag and tokens are both readable at first paint.
  //
  // A reload re-reads both from storage, so the gate is satisfied on the
  // first render. WorkspaceSwitcher already enters this way for the same
  // reason. The real fix is to make the gate reactive rather than
  // read-once — until then, do what the working path does.
  window.location.href = nodeBasename();
}

// ── A joined workspace that still needs a display name ───────────────────────
//
// The name step lives in the picker. When an invitation is accepted by someone
// who has never chosen a name, the prompt hands the joined workspace to the
// picker through this marker and a load of /login; the picker then
// opens straight on "Join <workspace>" instead of the list.

const AWAITING_NAME_KEY = "chat:joined-awaiting-name";

/**
 * Mark a just-joined workspace for the picker's name step, without moving:
 * a sign-up that joined through the invite link lands on the picker as is.
 */
export function markJoinedAwaitingName(namespaceId: string): void {
  try {
    sessionStorage.setItem(AWAITING_NAME_KEY, namespaceId);
  } catch {
    /* no session storage — the picker falls back to its list, preselected */
  }
  try {
    setGroupId(namespaceId);
  } catch {
    /* blocked storage: the picker's list still has it */
  }
}

/** Hand a just-joined workspace to the picker's name step. */
export function enterJoinedWorkspaceForName(namespaceId: string): void {
  markJoinedAwaitingName(namespaceId);
  // Otherwise /login bounces a user already inside a workspace back to "/".
  clearNamespaceReady();
  window.location.href = nodeBasename() + "login";
}

/**
 * The workspace waiting for a name, if any.
 *
 * Read, not consumed: the picker's load can run more than once (a late auth
 * state, StrictMode in dev), and every run must land on the same name step.
 * It is forgotten when the user enters a workspace or backs out of the step.
 */
export function joinedAwaitingName(): string | null {
  try {
    return sessionStorage.getItem(AWAITING_NAME_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetJoinedAwaitingName(): void {
  try {
    sessionStorage.removeItem(AWAITING_NAME_KEY);
  } catch {
    /* nothing stored, nothing to forget */
  }
}
