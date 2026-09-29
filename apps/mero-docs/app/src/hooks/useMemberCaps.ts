// Resolve the caller's EFFECTIVE capability bitmask for a given
// group. Effective = role-OR-override.
//
// Background - the server uses two orthogonal fields for authz
// (core/context/group_store/membership.rs:172):
//   - `role` (Admin | Member | ReadOnly): Admins bypass every cap
//     check.
//   - `capabilities` (u32 bitmask): per-member delegation for
//     non-admin members.
//
// Why we DON'T use mero-react's useGroupCapabilities / useGroupMembers:
//   Right after `create_group_in_namespace`, the creator's membership row
//   is published as a governance op but materialised asynchronously. For a
//   short window (~0-2s) both `listGroupMembers` shows no matching identity
//   and `getMemberCapabilities` returns 500 "identity is not a member".
//   mero-react's hooks fire once on mount and don't retry - we'd stay
//   stuck on that transient 500 until the next rerender. So we own the
//   fetch here and retry on propagation-lag errors.
//
// Retry schedule: 4 attempts at 0 / 500ms / 1500ms / 3500ms - about
// 5.5s end-to-end. Empirically the governance op lands in <1s; the
// long tail exists so hot-reloads / slow nodes also settle cleanly.
//
// State convention:
//   - `caps = null, error = null` → loading (including retries).
//   - `caps = 0,    error = null` → non-admin with no override bits.
//   - `caps > 0,    error = null` → actual bitmask (or 0xffffffff for
//     Admins - `isAdmin` is the authoritative signal, the all-bits mask
//     just keeps `hasCap(...)` true for everything).
//   - `caps = 0,    error = Error` → retries exhausted; caller shows
//     an error affordance rather than silently rendering "all denied".
//     `denied` is set when every attempt was refused as a non-member.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { useContextEvents } from './useContextEvents';
import { useDriveWorkspace } from './useDriveWorkspace';

// A u32 with every bit set - what we report as `caps` for a group-admin
// so consumers' `isAdmin || hasCap(caps, bit)` checks all pass even if
// they happen to ignore `isAdmin`. `>>> 0` normalises to unsigned.
const ADMIN_CAPS_BITMASK = 0xffffffff >>> 0;

const RETRY_DELAYS_MS = [0, 500, 1500, 3500];

const LOADING = { caps: null, isAdmin: false, isReadOnly: false, error: null, denied: false };

export interface MemberCapsState {
  caps: number | null;
  /** True when the caller is a core group-admin on this group - bypasses
   *  the capability bitmask entirely (mirrors the server's
   *  `is_group_admin_or_has_capability`). */
  isAdmin: boolean;
  /** True when the caller is core ReadOnly on this group: core discards
   *  every state write they make in its contexts. */
  isReadOnly: boolean;
  error: Error | null;
  /** `error` is the non-member refusal outlasting every retry. */
  denied: boolean;
  /** Force the underlying fetch (members + capabilities) to re-run.
   *  Needed after an external membership-changing op (e.g. the
   *  RestrictedFolderCard's join-via-inheritance click) - the
   *  effect's deps `[mero, groupId, memberId]` don't change, so a
   *  successful join wouldn't otherwise lift a previously-cached
   *  "identity is not a member" error. */
  refetch: () => void;
}

// Core refuses a non-member with an untyped 500, so only its text tells it apart.
function isPropagationLagError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('not a member');
}

function sleep(ms: number, signal: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (ms === 0) {
      resolve();
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    // Poll the abort signal cheaply - if the hook unmounts mid-sleep
    // we want to resolve immediately so the async loop can bail.
    const poll = setInterval(() => {
      if (signal.aborted) {
        clearTimeout(t);
        clearInterval(poll);
        resolve();
      }
    }, 50);
    // Clean up the poller when the timeout fires naturally.
    setTimeout(() => clearInterval(poll), ms);
  });
}

// `namespaceId` is retained in the signature (unused at this layer)
// so consumers don't need to change imports. Identity comes from
// the active workspace via useDriveWorkspace - every call site
// operates on the currently-selected namespace.
export function useMemberCaps(
  _namespaceId: string,
  groupId: string,
): MemberCapsState {
  const { mero } = useMero();
  const { selfIdentity, registryContextId } = useDriveWorkspace();
  const memberId = selfIdentity ?? '';

  const [state, setState] = useState<Omit<MemberCapsState, 'refetch'>>(LOADING);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  // Caps change without a context event; the registry's sync run is the tick.
  useContextEvents(registryContextId, refetch, {
    strict: true,
    debounceMs: 400,
  });

  // Reset caps to null only when (groupId, memberId) really change; a plain
  // refetch keeps the prior value, or every SSE tick flickers gated UI off/on.
  const lastIdsRef = useRef<{ groupId: string; memberId: string } | null>(null);

  useEffect(() => {
    if (!mero || !groupId || !memberId) {
      lastIdsRef.current = null;
      setState(LOADING);
      return;
    }
    const signal = { aborted: false };
    const idsChanged =
      !lastIdsRef.current ||
      lastIdsRef.current.groupId !== groupId ||
      lastIdsRef.current.memberId !== memberId;
    lastIdsRef.current = { groupId, memberId };
    if (idsChanged) {
      setState(LOADING);
    }

    (async () => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (signal.aborted) return;
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt], signal);
        if (signal.aborted) return;
        try {
          // 1) Read the members list - used ONLY to detect the Admin
          //    short-circuit.
          const { members: membersList } =
            await mero.admin.listGroupMembers(groupId);
          if (signal.aborted) return;
          const me = membersList.find(
            (m) => m.identity === memberId,
          );

          // 2) Admin short-circuit - mirrors the server's
          //    `is_group_admin_or_has_capability` logic. Only DIRECT
          //    members carry a role on the list; an inherited Open-
          //    subgroup member has no row at all (and is never an
          //    admin), so a list miss is NOT "not a member" - it just
          //    means fall through to the capability probe below.
          if (me?.role === 'Admin') {
            if (!signal.aborted) {
              setState((prev) =>
                prev.caps === ADMIN_CAPS_BITMASK &&
                prev.isAdmin === true &&
                prev.error === null
                  ? prev
                  : {
                      caps: ADMIN_CAPS_BITMASK,
                      isAdmin: true,
                      isReadOnly: false,
                      error: null,
                      denied: false,
                    },
              );
            }
            return;
          }

          // 3) Resolve the capability bitmask. This - NOT the members-
          //    list lookup - is the authoritative membership gate. An
          //    inherited Open-subgroup member is absent from
          //    `listGroupMembers` by core design (no materialised
          //    GroupMember row - see `execute_member_joined_open` in
          //    namespace_governance.rs), but `getMemberCapabilities`
          //    resolves them via core's parent-walk
          //    and returns 0. A genuine non-member instead throws
          //    "identity is not a member" → propagation-lag retry.
          const result = await mero.admin.getMemberCapabilities(
            groupId,
            memberId,
          );
          if (signal.aborted) return;
          const caps = result.capabilities ?? 0;
          const isReadOnly = me?.role === 'ReadOnly';
          // Diff-guard: an SSE-triggered refetch (tick bump) that
          // resolves to the same caps/isAdmin/error must not replace
          // `state` with a new-but-equal object - a fresh object
          // literal here would always fail React's Object.is bail
          // check and re-render every row on every unrelated context
          // event (e.g. a doc autosave). Returning `prev` when nothing
          // changed lets React skip the re-render.
          setState((prev) =>
            prev.caps === caps &&
            prev.isAdmin === false &&
            prev.isReadOnly === isReadOnly &&
            prev.error === null
              ? prev
              : { caps, isAdmin: false, isReadOnly, error: null, denied: false },
          );
          return;
        } catch (err) {
          lastErr = err;
          if (!isPropagationLagError(err)) break;
          // else fall through to next attempt
        }
      }
      if (signal.aborted) return;
      const finalErr =
        lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      const refused = isPropagationLagError(lastErr);
      // A fault is not an answer: only a refusal may take away caps a read already granted.
      const last = stateRef.current;
      if (!refused && last.caps !== null && last.error === null) {
        console.warn(
          '[useMemberCaps] re-read failed; keeping last caps',
          finalErr,
        );
        return;
      }
      setState({
        caps: 0,
        isAdmin: false,
        isReadOnly: false,
        error: finalErr,
        denied: refused,
      });
    })();

    return () => {
      signal.aborted = true;
    };
  }, [mero, groupId, memberId, tick]);

  return { ...state, refetch };
}
