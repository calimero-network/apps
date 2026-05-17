import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import { clearWorkspaceSelection, getGroupId } from "../constants/config";
import { clearNamespaceReady } from "../utils/session";
import { useToast } from "../contexts/ToastContext";

const POLL_INTERVAL_MS = 30_000;

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
 * a subsequent 404 from that point means the server has cascaded us out.
 *
 * On transient errors (any non-404), we do nothing — we'd rather miss a
 * tick than redirect on a flaky network.
 */
export function useNamespaceMembershipWatch(): void {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const everHadIdentity = useRef(false);
  const removedRef = useRef(false);

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
      clearWorkspaceSelection();
      clearNamespaceReady();
      navigate("/login");
    };

    const check = async () => {
      if (cancelled || removedRef.current) return;
      const resp = await api.resolveCurrentMemberIdentity(groupId, "");
      if (cancelled || removedRef.current) return;

      if (resp.data?.memberIdentity) {
        everHadIdentity.current = true;
        return;
      }
      if (everHadIdentity.current && resp.error?.code === 404) {
        handleRemoval();
      }
    };

    void check();
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [navigate, addToast]);
}
