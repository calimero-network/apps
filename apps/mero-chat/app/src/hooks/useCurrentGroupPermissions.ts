import { useCallback, useEffect, useMemo, useState } from "react";
import { GroupApiDataSource } from "../api/dataSource/groupApiDataSource";
import {
  getGroupMemberIdentity,
  setGroupMemberIdentity,
} from "../constants/config";
import {
  canCreateGroupContexts,
  canCreateSubgroup,
  canDeleteSubgroup,
  canInviteWorkspaceMembers,
  canJoinOpenSubgroups,
  canManageVisibility,
} from "../utils/groupCapabilities";
import { findSelfMember } from "../utils/groupMemberIdentity";

interface CurrentGroupPermissionsState {
  loading: boolean;
  memberIdentity: string;
  isAdmin: boolean;
  isModerator: boolean;
  capabilities: number | null;
  canCreateContext: boolean;
  canInviteMembers: boolean;
  canJoinOpenSubgroups: boolean;
  canCreateSubgroup: boolean;
  canDeleteSubgroup: boolean;
  canManageVisibility: boolean;
  /**
   * Why the role could not be read, or null. Set only when the FIRST read of
   * this workspace fails: a caller that hides an admin control on `!isAdmin`
   * must be able to tell "not an admin" from "could not tell", or an admin
   * whose read failed loses the control with no word of why.
   */
  error: string | null;
}

const initialState: CurrentGroupPermissionsState = {
  loading: false,
  memberIdentity: "",
  isAdmin: false,
  isModerator: false,
  capabilities: null,
  canCreateContext: false,
  canInviteMembers: false,
  canJoinOpenSubgroups: false,
  canCreateSubgroup: false,
  canDeleteSubgroup: false,
  canManageVisibility: false,
  error: null,
};

const POLL_INTERVAL_MS = 30_000;

export function useCurrentGroupPermissions(groupId: string) {
  const [state, setState] = useState<CurrentGroupPermissionsState>(initialState);
  // Bumped by `retry` to run the first-load path again.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!groupId) {
      setState(initialState);
      return;
    }

    let cancelled = false;

    // Poll on a 30s cadence: capabilities/role can change at any time when
    // an admin grants or revokes a member's permissions, and there's no
    // SSE channel for governance ops, so the hook must re-fetch to reflect
    // server state (e.g. the "+" channel button reappearing after an admin
    // re-grants CAN_CREATE_SUBGROUP).
    //
    // `silent=true` on polled refreshes: don't flip `loading` back to true
    // mid-session, otherwise consumers that gate on `!loading` would
    // flicker between "resolved" and "loading" every 30s.
    const loadPermissions = async (silent: boolean = false) => {
      if (!silent) {
        setState((previous) => ({ ...previous, loading: true }));
      }

      const api = new GroupApiDataSource();
      const storedMemberIdentity = getGroupMemberIdentity(groupId);
      const identityResponse = await api.resolveCurrentMemberIdentity(
        groupId,
        storedMemberIdentity,
      );

      if (cancelled) {
        return;
      }

      if (identityResponse.error || !identityResponse.data) {
        // On the initial load surface the failure (UI shows "no
        // permissions" until something works). On polled refreshes
        // swallow transient errors — keep the last known-good state so
        // a single flaky request doesn't briefly hide gated buttons.
        if (!silent) {
          setState({
            ...initialState,
            error:
              identityResponse.error?.message ||
              "Could not read your role in this workspace.",
          });
        }
        return;
      }

      const { memberIdentity, members } = identityResponse.data;
      setGroupMemberIdentity(groupId, memberIdentity);

      // Not `member.identity === memberIdentity`: the server can key member
      // rows by ACCOUNT while reporting `selfIdentity` as a signing key, and
      // an account is a one-way hash of the key. A direct comparison then
      // matches nothing, this returns `initialState`, and the user loses every
      // permission — an admin included. See calimero-network/core#3402.
      const currentMember = findSelfMember({ members, selfIdentity: memberIdentity });

      if (!currentMember) {
        // Not on the roster we were handed: a membership that has not landed
        // yet, or an identity mismatch. Either way, unknown, not "member".
        if (!silent) {
          setState({
            ...initialState,
            memberIdentity,
            error: "Could not find you in this workspace's member list.",
          });
        }
        return;
      }

      const role = String(currentMember.role ?? "").toLowerCase();

      if (role === "admin") {
        setState({
          loading: false,
          memberIdentity,
          isAdmin: true,
          isModerator: false,
          capabilities: null,
          canCreateContext: true,
          canInviteMembers: true,
          canJoinOpenSubgroups: true,
          canCreateSubgroup: true,
          canDeleteSubgroup: true,
          canManageVisibility: true,
          error: null,
        });
        return;
      }

      if (role === "moderator") {
        setState({
          loading: false,
          memberIdentity,
          isAdmin: false,
          isModerator: true,
          capabilities: null,
          canCreateContext: true,
          canInviteMembers: true,
          canJoinOpenSubgroups: true,
          canCreateSubgroup: true,
          canDeleteSubgroup: true,
          canManageVisibility: true,
          error: null,
        });
        return;
      }

      const capabilitiesResponse = await api.getMemberCapabilities(
        groupId,
        memberIdentity,
      );

      if (cancelled) {
        return;
      }

      const capabilities = capabilitiesResponse.data?.capabilities ?? null;

      setState({
        loading: false,
        memberIdentity,
        isAdmin: false,
        isModerator: false,
        capabilities,
        canCreateContext: canCreateGroupContexts(capabilities),
        canInviteMembers: canInviteWorkspaceMembers(capabilities),
        canJoinOpenSubgroups: canJoinOpenSubgroups(capabilities),
        canCreateSubgroup: canCreateSubgroup(capabilities),
        canDeleteSubgroup: canDeleteSubgroup(capabilities),
        canManageVisibility: canManageVisibility(capabilities),
        error: null,
      });
    };

    void loadPermissions();
    const interval = setInterval(() => {
      void loadPermissions(true);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [groupId, attempt]);

  // Memoised: callers put this object in effect deps, and a fresh one every
  // render would re-run them on every render.
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
