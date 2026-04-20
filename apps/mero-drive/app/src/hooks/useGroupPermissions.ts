import { useCallback, useEffect, useState } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { adminRequest } from '@/api/AdminApi';
import { normalizeContextIdForJoin } from '@/api/contextIdJoin';
import { WorkspaceManager, type MemberInfo } from '@/api/WorkspaceManager';
import { getGroupMemberIdentity, setGroupMemberIdentity } from '@/constants/config';
import { useWorkspace } from '@/context/WorkspaceContext';
import { decodeMemberCapabilitiesBitmask, type MemberCapabilityFlags } from '@/utils/groupCapabilities';

export interface UseGroupPermissionsResult {
  members: MemberInfo[];
  currentMemberIdentity: string | null;
  isAdmin: boolean;
  capabilityFlags: MemberCapabilityFlags | null;
  capabilitiesMask: number | undefined;
  canCreateContext: boolean;
  canInviteMembers: boolean;
  canJoinOpenContexts: boolean;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useGroupPermissions(): UseGroupPermissionsResult {
  const { app } = useCalimero();
  const { activeGroupId, activeContextId, generalContextId } = useWorkspace();

  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [currentMemberIdentity, setCurrentMemberIdentity] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [capabilityFlags, setCapabilityFlags] = useState<MemberCapabilityFlags | null>(null);
  const [capabilitiesMask, setCapabilitiesMask] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!activeGroupId || !app) {
      setMembers([]);
      setCurrentMemberIdentity(null);
      setIsAdmin(false);
      setCapabilityFlags(null);
      setCapabilitiesMask(undefined);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const manager = new WorkspaceManager(app);
      const { members: memberList, selfIdentity } = await manager.getWorkspaceMembers(activeGroupId);
      setMembers(memberList);

      let myIdentity = '';
      let source = '';

      // 1. selfIdentity returned by the admin API
      if (selfIdentity && memberList.some((m) => m.identity === selfIdentity)) {
        myIdentity = selfIdentity;
        source = 'api-self-identity';
      }

      // 2. Cached identity in localStorage
      if (!myIdentity) {
        const stored = getGroupMemberIdentity(activeGroupId);
        if (stored && memberList.some((m) => m.identity === stored)) {
          myIdentity = stored;
          source = 'localStorage';
        }
      }

      // 3. identities-owned lookup (always tried when above fail)
      if (!myIdentity) {
        const contextId = generalContextId || activeContextId;
        if (contextId) {
          try {
            const pathId = normalizeContextIdForJoin(contextId);
            const data = await adminRequest<{ identities: string[] }>(
              `/contexts/${encodeURIComponent(pathId)}/identities-owned`,
            );
            const match = (data.identities ?? []).find((id) =>
              memberList.some((m) => m.identity === id),
            );
            if (match) {
              myIdentity = match;
              source = 'identities-owned';
            }
          } catch (err) {
            console.warn('[Permissions] identities-owned failed:', err);
          }
        } else {
          console.warn('[Permissions] no contextId available for identities-owned lookup');
        }
      }

      // 4. Single-member fallback
      if (!myIdentity && memberList.length === 1) {
        myIdentity = memberList[0].identity;
        source = 'single-member';
      }

      console.warn(
        '[Permissions] resolved identity:',
        myIdentity || '(none)',
        'via',
        source || 'unresolved',
      );

      if (myIdentity) {
        setGroupMemberIdentity(activeGroupId, myIdentity);
      }

      setCurrentMemberIdentity(myIdentity || null);

      const self = myIdentity
        ? memberList.find((m) => m.identity === myIdentity)
        : undefined;

      const admin = self?.role === 'Admin';
      setIsAdmin(admin);
      console.warn('[Permissions] isAdmin:', admin, 'role:', self?.role);

      if (!myIdentity) {
        setCapabilityFlags(null);
        setCapabilitiesMask(undefined);
        return;
      }

      try {
        const mask = await manager.getMemberCapabilities(activeGroupId, myIdentity);
        setCapabilitiesMask(mask);
        setCapabilityFlags(decodeMemberCapabilitiesBitmask(mask));
      } catch {
        setCapabilitiesMask(undefined);
        setCapabilityFlags(null);
      }
    } catch (err) {
      console.warn('[Permissions] load failed:', err);
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setMembers([]);
      setCurrentMemberIdentity(null);
      setIsAdmin(false);
      setCapabilityFlags(null);
      setCapabilitiesMask(undefined);
    } finally {
      setIsLoading(false);
    }
  }, [activeContextId, activeGroupId, app, generalContextId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flags = capabilityFlags ?? {
    canCreateContext: false,
    canInviteMembers: false,
    canJoinOpenContexts: false,
  };

  return {
    members,
    currentMemberIdentity,
    isAdmin,
    capabilityFlags,
    capabilitiesMask,
    canCreateContext: isAdmin || flags.canCreateContext,
    canInviteMembers: isAdmin || flags.canInviteMembers,
    canJoinOpenContexts: isAdmin || flags.canJoinOpenContexts,
    isLoading,
    error,
    refresh: load,
  };
}
