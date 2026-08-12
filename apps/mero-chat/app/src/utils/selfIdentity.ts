import { getContextIdentity } from "@calimero-network/mero-react";

import {
  getContextMemberIdentity,
  getGroupId,
  getGroupMemberIdentity,
} from "../constants/config";
import { getStoredExecutorIdentity } from "./messengerName";

/**
 * Every identity this NODE owns in a context, keyed by context id.
 *
 * A node can hold more than one identity in the same context. The app used to
 * keep only `fetchContextIdentities(...)[0]`, so when a message was signed by
 * any of the others it looked like it came from a stranger — which is why the
 * user's own messages were toasted. All of them are us; record all of them.
 *
 * Module-level because the self-check is synchronous and runs inside event
 * handling, while the identity list arrives from an async fetch.
 */
const contextIdentities = new Map<string, Set<string>>();

/** Record every identity this node owns in `contextId`. */
export function registerContextIdentities(
  contextId: string,
  identities: readonly string[] | undefined | null,
): void {
  if (!contextId || !identities?.length) return;
  const existing = contextIdentities.get(contextId) ?? new Set<string>();
  for (const id of identities) {
    if (id) existing.add(id);
  }
  contextIdentities.set(contextId, existing);
}

/**
 * This node's ACCOUNT identities (and device ids), not scoped to a context.
 *
 * The contract stamps `sender` with `env::account_id()`, which is a different
 * identifier space from the device keys returned by `contexts/{id}/identities`.
 * Populated by `loadSelfAccountIdentity`.
 */
const accountIdentities = new Set<string>();

/** Record an identity that is this node's, in any context. */
export function registerAccountIdentity(identity: string | null | undefined): void {
  if (identity) accountIdentities.add(identity);
}

/** Test seam: forget everything registered so far. */
export function clearRegisteredContextIdentities(): void {
  contextIdentities.clear();
  accountIdentities.clear();
}

/**
 * Every identity that could legitimately be "me" in `contextId`.
 *
 * Identity is per context, and the app records it in several places that do
 * not always agree:
 *   - `getContextMemberIdentity(contextId)` — written when joining a context
 *   - `getGroupMemberIdentity(groupId)`     — namespace-level member identity
 *   - `getStoredExecutorIdentity()`         — last executor used
 *   - `getContextIdentity()` (mero-react)   — a single global value
 *   - the caller's own hints (identity map / active chat)
 *
 * Comparing a message's sender against only ONE of these is why the user's own
 * messages were being toasted: `contextIdentityMap` is populated from
 * `fetchContextIdentities(...)[0]`, which is not necessarily the identity that
 * actually signed the message when a node holds more than one in a context.
 *
 * Extra candidates cannot cause a false "mine": these are all *this* device's
 * own keys, so another member's sender can never match one.
 */
export function selfIdentities(
  contextId: string,
  ...hints: (string | null | undefined)[]
): Set<string> {
  // Each source is read defensively: this runs inside the notification path,
  // which is wrapped in a try/catch, so one throwing getter would silently
  // swallow ALL notifications rather than just contributing no candidate.
  const read = (fn: () => string | null | undefined): string => {
    try {
      return fn() ?? "";
    } catch {
      return "";
    }
  };

  const groupId = read(getGroupId);
  const candidates = [
    ...hints,
    // The account id the contract actually stamps on `sender`. This is the
    // one that matches; everything else here is a device-space id.
    ...accountIdentities,
    // Every identity the node owns in this context — the authoritative set.
    ...(contextId ? [...(contextIdentities.get(contextId) ?? [])] : []),
    contextId ? read(() => getContextMemberIdentity(contextId)) : "",
    groupId ? read(() => getGroupMemberIdentity(groupId)) : "",
    read(getStoredExecutorIdentity),
    read(getContextIdentity),
  ];
  return new Set(candidates.filter((c): c is string => Boolean(c)));
}

/** Was `sender` this device, in `contextId`? */
export function isSelfSender(
  sender: string | null | undefined,
  contextId: string,
  ...hints: (string | null | undefined)[]
): boolean {
  if (!sender) return false;
  return selfIdentities(contextId, ...hints).has(sender);
}
