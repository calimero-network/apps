import type { GroupApi } from "../api/groupApi";
import { setGroupId, setGroupMemberIdentity } from "../constants/config";
import { log } from "./logger";
import {
  setIdentityDisplayName,
  setMessengerDisplayName,
} from "./messengerName";
import { ensureNotificationPermission } from "./notificationPermission";
import {
  clearNamespaceReady,
  clearStoredSession,
  setNamespaceReady,
} from "./session";

// Two places put the user into a workspace: the workspace picker
// (`NamespaceEntryPopup`) and the app-level invitation prompt
// (`InvitationPrompt`), which can fire on any page — including inside another
// workspace. Both end here so they enter the same way.

/**
 * Commit the workspace, publish the chosen handle as the namespace-level member
 * name, and load the chat. The user only gets the channels they explicitly
 * join (self-join for Open subgroups, admin-add for Restricted) — no
 * force-joining contexts at workspace entry.
 */
export function enterWorkspace(
  api: Pick<GroupApi, "setMemberMetadata">,
  namespaceId: string,
  username: string,
  memberIdentity: string,
): void {
  setGroupId(namespaceId);
  setMessengerDisplayName(username);
  if (memberIdentity) {
    setGroupMemberIdentity(namespaceId, memberIdentity);
    setIdentityDisplayName(memberIdentity, username);
    // Propagate the chosen handle as the namespace-level member name.
    // Without this, other users' `listMembers(namespaceId)` returns
    // this member with `name: null` and the channel/DM/admin UIs all
    // fall through to displaying the raw identity string.
    if (username) {
      void api
        .setMemberMetadata(namespaceId, memberIdentity, { name: username })
        .then((res) => {
          // Was silently swallowed. That is how this shipped broken: core
          // rejects a device key with "Invalid account format: expected 64
          // hex characters", the member stayed nameless, and nothing said so.
          if (res.error) {
            log.warn(
              "NamespaceEntry",
              `could not publish member name: ${res.error.message}`,
            );
          }
        })
        .catch((err) => {
          log.warn("NamespaceEntry", "could not publish member name", err);
        });
    }
  }
  forgetJoinedAwaitingName();
  clearStoredSession();
  setNamespaceReady();
  // Ask for OS notification permission once, here: entry is a real user
  // gesture (Safari requires one) and it covers desktop/browser users who
  // never trigger the PWA `appinstalled` event. Deliberately not awaited —
  // entry must not block on the browser prompt.
  void ensureNotificationPermission();
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
  window.location.href = "/";
}

// ── A joined workspace that still needs a display name ───────────────────────
//
// The name step lives in the picker. When an invitation is accepted by someone
// who has never chosen a name, the prompt hands the joined workspace to the
// picker through this marker and a load of /login; the picker then
// opens straight on "Join <workspace>" instead of the list.

const AWAITING_NAME_KEY = "chat:joined-awaiting-name";

/** Hand a just-joined workspace to the picker's name step. */
export function enterJoinedWorkspaceForName(namespaceId: string): void {
  try {
    sessionStorage.setItem(AWAITING_NAME_KEY, namespaceId);
  } catch {
    /* no session storage — the picker falls back to its list, preselected */
  }
  setGroupId(namespaceId);
  // Otherwise /login bounces a user already inside a workspace back to "/".
  clearNamespaceReady();
  window.location.href = "/login";
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
