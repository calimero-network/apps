import type { ActiveChat } from "../types/Common";
import { getGroupId } from "../constants/config";
import { StorageHelper } from "./storage";
import { log } from "./logger";

/**
 * Validator for ActiveChat to ensure it has required properties
 */
const isValidActiveChat = (data: unknown): boolean => {
  if (!data || typeof data !== "object") return false;
  const chat = data as Record<string, unknown>;
  return !!(chat.type && chat.id && chat.name);
};

export const updateSessionChat = (session: ActiveChat): void => {
  StorageHelper.setJSON("lastSession", session);
};

export const getStoredSession = (): ActiveChat | null => {
  const session = StorageHelper.getJSON<ActiveChat>(
    "lastSession",
    isValidActiveChat,
  );
  if (!session) {
    log.debug("Session", "No valid session found in storage");
  }
  return session;
};

export const clearStoredSession = (): void => {
  StorageHelper.removeItem("lastSession");
  log.debug("Session", "Session cleared from storage");
};

// ── Namespace-ready gate ──────────────────────────────────────────────────────
//
// Remembers the workspace the user last ENTERED, so a reload, a new tab or a
// PWA relaunch lands back in it instead of on the picker every time. It used to
// live in sessionStorage, which made every fresh tab pick again.
//
// It lives in localStorage now but is still not a free pass:
//   - it stores the namespace id that was entered, and only counts while that
//     is still the current group id — a group id that changed without going
//     through entry (a `group-id` link, a stale value) opens the picker;
//   - a logout, a fresh Connect (its storage wipe does not preserve it), leaving
//     or deleting the workspace, and losing membership all clear it, so a fresh
//     login still goes through the picker.

/** Exported for tests and the Connect wipe's guard. */
export const NS_ENTERED_KEY = "curb_ns_entered";
// The per-tab "1" an older build set. Read so an open tab survives the
// upgrade; promoted to the durable marker the first time it is read.
const LEGACY_NS_READY_KEY = "curb_ns_ready";

export function setNamespaceReady(namespaceId: string): void {
  if (!namespaceId) return;
  try {
    localStorage.setItem(NS_ENTERED_KEY, namespaceId);
  } catch {
    /* blocked storage: the picker comes back on reload, nothing worse */
  }
}

export function isNamespaceReady(): boolean {
  const current = getGroupId();
  if (!current) return false;
  try {
    if (localStorage.getItem(NS_ENTERED_KEY) === current) return true;
    if (sessionStorage.getItem(LEGACY_NS_READY_KEY) === "1") {
      setNamespaceReady(current);
      return true;
    }
  } catch {
    /* blocked storage reads as not entered */
  }
  return false;
}

export function clearNamespaceReady(): void {
  try {
    localStorage.removeItem(NS_ENTERED_KEY);
    sessionStorage.removeItem(LEGACY_NS_READY_KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
}
