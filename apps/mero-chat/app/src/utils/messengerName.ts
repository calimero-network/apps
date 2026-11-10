import { forgetLastUsedName, rememberLastUsedName } from "@calimero-apps/names";
import { getGroupId } from "../constants/config";
import { StorageHelper } from "./storage";

// Your name is per workspace (namespace): asked once when you create or join
// one, kept here under that workspace's id. The old single app-wide key
// (`chat-username`) made every workspace show the first name you ever picked.
const LEGACY_NAME_KEY = "chat-username";
const NAME_KEY_PREFIX = "chat-username:";
const nameKey = (namespaceId: string) => `${NAME_KEY_PREFIX}${namespaceId}`;
const IDENTITY_NAME_PREFIX = "curb_username_";
// calimero-client stores the executor's public key under this key
const CONTEXT_IDENTITY_KEY = "context-identity";

/** Returns the stored executor public key (set by calimero-client's setExecutorPublicKey). */
export function getStoredExecutorIdentity(): string {
  try {
    const raw = StorageHelper.getItem(CONTEXT_IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as string) : "";
  } catch {
    return "";
  }
}

/** Your name in `namespaceId` (default: the current workspace), or "" when it has none. */
export function getMessengerDisplayName(namespaceId: string = getGroupId()): string {
  if (!namespaceId) return "";
  return (StorageHelper.getItem(nameKey(namespaceId)) || "").trim();
}

/** Forget every workspace's name on this browser (signing out). */
export function clearMessengerDisplayName(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === LEGACY_NAME_KEY || key.startsWith(NAME_KEY_PREFIX))) keys.push(key);
    }
    keys.forEach((k) => StorageHelper.removeItem(k));
  } catch {
    StorageHelper.removeItem(LEGACY_NAME_KEY);
  }
  // Signing out: the next person on this browser is not offered this name.
  forgetLastUsedName();
}

/** Your name in `namespaceId` (default: the current workspace). */
export function setMessengerDisplayName(name: string, namespaceId: string = getGroupId()): void {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  if (namespaceId) StorageHelper.setItem(nameKey(namespaceId), trimmedName);
  // The prefill every Calimero app offers when a new team asks for a name.
  rememberLastUsedName(trimmedName);
}

/**
 * Your name in the current workspace. The identity argument is kept so call
 * sites don't change; the name is keyed by workspace, not by identity (each
 * channel gives a person a different executor id).
 */
export function getIdentityDisplayName(_memberIdentity: string): string {
  return getMessengerDisplayName();
}

/**
 * No-op: `enterWorkspace` stores the name under the workspace being entered.
 * Writing here, before the workspace switches, stored it under the previous one.
 */
export function setIdentityDisplayName(_memberIdentity: string, _name: string): void {}

export function clearIdentityDisplayName(_memberIdentity: string): void {
  // No-op under the global-name model. The global handle is cleared via
  // `clearMessengerDisplayName`, which is invoked from the explicit
  // "change my name" path — not from per-identity cleanup.
}

/**
 * One-shot cleanup of the legacy per-identity rows. Safe to call on app
 * startup: idempotent, never touches the global handle.
 */
export function purgeLegacyIdentityDisplayNames(): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(IDENTITY_NAME_PREFIX)) {
        toDelete.push(key);
      }
    }
    toDelete.forEach((k) => StorageHelper.removeItem(k));
  } catch {
    /* ignore — storage may be unavailable */
  }
}
