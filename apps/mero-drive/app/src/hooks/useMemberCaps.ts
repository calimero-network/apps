// Resolve the caller's EFFECTIVE capability bitmask for a given
// group. Effective = role-OR-override.
//
// Background — the server uses two orthogonal fields for authz
// (core/context/group_store/membership.rs:172):
//   - `role` (Admin | Member | ReadOnly): Admins bypass every cap
//     check.
//   - `capabilities` (u32 bitmask): per-member delegation for
//     non-admin members.
//
// Why we DON'T use mero-react's useGroupCapabilities / useGroupMembers:
//   1. `listGroupMembers` is wire-shaped `{members, selfIdentity}` but
//      mero-js's typed client expects `{data}` — so the typed path
//      returns an empty array. We bypass it by casting through unknown.
//   2. Right after `create_group_in_namespace`, the creator's
//      membership row is published as a governance op but materialised
//      asynchronously. For a short window (~0-2s) both
//      `listGroupMembers` shows no matching identity and
//      `getMemberCapabilities` returns 500 "identity is not a member".
//      mero-react's hooks fire once on mount and don't retry — we'd
//      stay stuck on that transient 500 until the next rerender. So
//      we own the fetch here and retry on propagation-lag errors.
//
// Retry schedule: 4 attempts at 0 / 500ms / 1500ms / 3500ms — about
// 5.5s end-to-end. Empirically the governance op lands in <1s; the
// long tail exists so hot-reloads / slow nodes also settle cleanly.
//
// State convention:
//   - `caps = null, error = null` → loading (including retries).
//   - `caps = 0,    error = null` → non-admin with no override bits.
//   - `caps > 0,    error = null` → actual bitmask (or 0xffffffff for
//     Admins — `isAdmin` is the authoritative signal, the all-bits mask
//     just keeps `hasCap(...)` true for everything).
//   - `caps = 0,    error = Error` → retries exhausted; caller shows
//     an error affordance rather than silently rendering "all denied".

import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';

// A u32 with every bit set — what we report as `caps` for a group-admin
// so consumers' `isAdmin || hasCap(caps, bit)` checks all pass even if
// they happen to ignore `isAdmin`. `>>> 0` normalises to unsigned.
const ADMIN_CAPS_BITMASK = 0xffffffff >>> 0;

const RETRY_DELAYS_MS = [0, 500, 1500, 3500];

export interface MemberCapsState {
  caps: number | null;
  /** True when the caller is a core group-admin on this group — bypasses
   *  the capability bitmask entirely (mirrors the server's
   *  `is_group_admin_or_has_capability`). */
  isAdmin: boolean;
  error: Error | null;
  /** Force the underlying fetch (members + capabilities) to re-run.
   *  Needed after an external membership-changing op (e.g. the
   *  RestrictedFolderCard's join-via-inheritance click) — the
   *  effect's deps `[mero, groupId, memberId]` don't change, so a
   *  successful join wouldn't otherwise lift a previously-cached
   *  "identity is not a member" error. */
  refetch: () => void;
}

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
    // Poll the abort signal cheaply — if the hook unmounts mid-sleep
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
// the active workspace via useDriveWorkspace — every call site
// operates on the currently-selected namespace.
export function useMemberCaps(
  _namespaceId: string,
  groupId: string,
): MemberCapsState {
  const { mero } = useMero();
  const { selfIdentity } = useDriveWorkspace();
  const memberId = selfIdentity ?? '';

  const [state, setState] = useState<Omit<MemberCapsState, 'refetch'>>({
    caps: null,
    isAdmin: false,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!mero || !groupId || !memberId) {
      setState({ caps: null, isAdmin: false, error: null });
      return;
    }
    const signal = { aborted: false };
    setState({ caps: null, isAdmin: false, error: null });

    (async () => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (signal.aborted) return;
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt], signal);
        if (signal.aborted) return;
        try {
          // 1) Read members list to discover our role. Cast through
          //    unknown because the DTS and wire shape disagree:
          //    some backend versions return `{ members, selfIdentity }`,
          //    others return `{ data: [...], selfIdentity }`.
          const raw = (await mero.admin.listGroupMembers(
            groupId,
          )) as unknown as {
            members?: Array<{ identity: string; role?: string }>;
            data?: Array<{ identity: string; role?: string }>;
          };
          if (signal.aborted) return;
          const membersList = raw.members ?? raw.data ?? [];
          const me = membersList.find(
            (m) => m.identity === memberId,
          );
          if (!me) {
            lastErr = new Error('identity is not a member of group');
            continue; // propagation lag — retry
          }

          // 2) Admin short-circuit — mirrors the server's
          //    `is_group_admin_or_has_capability` logic.
          if (me.role === 'Admin') {
            if (!signal.aborted) {
              setState({
                caps: ADMIN_CAPS_BITMASK,
                isAdmin: true,
                error: null,
              });
            }
            return;
          }

          // 3) Non-admin: read the capability bitmask override.
          const result = await mero.admin.getMemberCapabilities(
            groupId,
            memberId,
          );
          if (signal.aborted) return;
          setState({
            caps: result.capabilities ?? 0,
            isAdmin: false,
            error: null,
          });
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
      setState({ caps: 0, isAdmin: false, error: finalErr });
    })();

    return () => {
      signal.aborted = true;
    };
  }, [mero, groupId, memberId, tick]);

  return { ...state, refetch };
}
