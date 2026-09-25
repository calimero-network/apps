import { StorageHelper } from "./storage";

const MESSENGER_NAME_KEY = "chat-username";
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

export function getMessengerDisplayName(): string {
  return (StorageHelper.getItem(MESSENGER_NAME_KEY) || "").trim();
}

export function clearMessengerDisplayName(): void {
  StorageHelper.removeItem(MESSENGER_NAME_KEY);
}

export function setMessengerDisplayName(name: string): void {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  StorageHelper.setItem(MESSENGER_NAME_KEY, trimmedName);
}

/**
 * Single-global-name model: identity-keyed display name is aliased to the
 * global `chat-username`. The legacy per-identity rows
 * (`curb_username_<identity>`) are no longer written; existing rows from
 * older sessions are silently ignored. The `memberIdentity` argument is
 * kept on the signature so callsites don't have to change, but it doesn't
 * affect storage.
 *
 * Rationale: in this app each context the user joins gets its own
 * `executor_id`, so a single human user accumulates many per-identity
 * rows for the same name. Users wanted one handle they pick once that
 * applies everywhere.
 */
export function getIdentityDisplayName(_memberIdentity: string): string {
  return getMessengerDisplayName();
}

export function setIdentityDisplayName(_memberIdentity: string, name: string): void {
  setMessengerDisplayName(name);
}

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
