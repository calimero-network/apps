import { useEffect, useRef } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { clearWorkspaceSelection, getGroupId } from "../constants/config";
import { clearNamespaceReady } from "../utils/session";
import { useToast } from "../contexts/ToastContext";
import { log } from "../utils/logger";

const POLL_INTERVAL_MS = 30_000;
/** Polls in a row that must say "removed" before the user is bounced. */
export const REMOVAL_CONFIRMATIONS = 2;

/**
 * What one poll says about the caller's membership.
 *
 * - `member`: the caller's row resolved.
 * - `removed`: core refused the caller as a non-member (403 "not a member"),
 *   or listed the members without the caller's row (the 404 the data source
 *   returns when nothing resolves).
 * - `unknown`: anything else, including core's 404 "group '<id>' not found".
 *   That one means this node has not applied the namespace's governance yet -
 *   it is lagging or stuck - and says nothing about the caller, so it must
 *   never read as a removal.
 */
export function classifyMembershipCheck(resp: {
  data?: { memberIdentity?: string } | null;
  error?: { code?: number; message?: string } | null;
}): "member" | "removed" | "unknown" {
  if (resp.data?.memberIdentity) return "member";
  const code = resp.error?.code;
  const message = resp.error?.message ?? "";
  if (code === 404 && /group '[^']*' not found/i.test(message)) return "unknown";
  if (code === 404) return "removed";
  if (code === 403 && /not a member/i.test(message)) return "removed";
  return "unknown";
}

/**
 * Detect when the current user has been removed from the active namespace
 * by an admin and bounce them out of the workspace.
 *
 * Why: the server cascades `MemberRemoved` (strips ContextIdentity rows,
 * adds the user to the namespace deny-list) but the curb UI has no SSE
 * channel for governance ops, so a removed user keeps seeing their stale
 * sidebar until they refresh. This poll closes that gap.
 *
 * How: we call `resolveCurrentMemberIdentity(groupId, "")` — pass empty
 * stored identity so the API does NOT fall back to the cached value when
 * `listMembers` returns 405 on older merods (that fallback path is meant
 * for "workspace entry on older nodes" and would mask a real removal).
 * After the first successful resolution we mark `everHadIdentity = true`;
 * from then on, REMOVAL_CONFIRMATIONS polls in a row that say "removed"
 * (see classifyMembershipCheck) mean the server has cascaded us out. One poll
 * is not enough: a member list still catching up can briefly lack our row.
 *
 * Anything else - a transient error, or a node that has not applied the
 * namespace yet ("group not found") - does nothing and resets the count:
 * we'd rather miss a tick than log someone out who was never removed.
 */
export function useNamespaceMembershipWatch(): void {
  const { addToast } = useToast();
  const everHadIdentity = useRef(false);
  const removedRef = useRef(false);
  const removalSignals = useRef(0);

  useEffect(() => {
    const groupId = getGroupId();
    if (!groupId) return;

    let cancelled = false;
    const api = new GroupApiDataSource();

    const handleRemoval = () => {
      if (removedRef.current) return;
      removedRef.current = true;
      addToast({
        title: "Workspace",
        message: "You have been removed from this workspace by an admin.",
        type: "channel",
        duration: 5000,
      });
      // Hard navigation, not navigate(): this clears the group id, and App.tsx
      // reads its route gate once per render — a client-side bounce can
      // ping-pong with <Navigate> until the browser kills it ("replaceState
      // more than 100 times per 10 seconds"). A location change starts from a
      // clean render tree with storage as the single source of truth.
      log.warn(
        "NamespaceMembershipWatch",
        "identity no longer resolves — treating as removed from workspace",
        { groupId },
      );
      clearWorkspaceSelection();
      clearNamespaceReady();
      window.location.replace("/login");
    };

    const check = async () => {
      if (cancelled || removedRef.current) return;
      const resp = await api.resolveCurrentMemberIdentity(groupId, "");
      if (cancelled || removedRef.current) return;

      const verdict = classifyMembershipCheck(resp);
      if (verdict === "member") {
        everHadIdentity.current = true;
        removalSignals.current = 0;
        return;
      }
      if (verdict === "unknown" || !everHadIdentity.current) {
        removalSignals.current = 0;
        return;
      }
      removalSignals.current += 1;
      if (removalSignals.current >= REMOVAL_CONFIRMATIONS) handleRemoval();
    };

    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [addToast]);
}
