import { useMemo } from "react";

import { selfAccount } from "../calimero/connection";
import { useMaybeWorkspace } from "../calimero/WorkspaceProvider";

/**
 * What the caller may do in the open workspace, from their org role. v1 read
 * capability bits of the namespace; in 1.0 an org's owner and admins
 * administer it (invite, remove, change roles) and every member and admin may
 * create channels and DMs. The node enforces each of these; this only decides
 * what the screens offer. `groupId` is accepted for the callers and must be
 * the open workspace.
 */
export function useCurrentGroupPermissions(_groupId?: string) {
  const ws = useMaybeWorkspace();
  return useMemo(() => {
    const role = ws?.role ?? null;
    const isAdmin = role === "owner" || role === "admin";
    const isMember = isAdmin || role === "member";
    return {
      loading: ws?.loading ?? false,
      memberIdentity: selfAccount(),
      isAdmin,
      isModerator: false,
      capabilities: null as number | null,
      canCreateContext: isMember,
      canInviteMembers: isAdmin,
      canJoinOpenSubgroups: true,
      canCreateSubgroup: isMember,
      canDeleteSubgroup: isAdmin,
      canManageVisibility: isAdmin,
      roleKnown: role !== null,
      error: ws?.error ?? null,
      retry: () => void ws?.refresh(),
    };
  }, [ws]);
}
