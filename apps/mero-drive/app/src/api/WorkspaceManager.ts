import { CalimeroApp } from '@calimero-network/calimero-client';
import { AbiClient } from './AbiClient';
import { getApplicationId } from '@/constants/config';
import {
  adminRequest,
  adminRequestFull,
  AdminApiError,
  createContextForGroup,
  DEFAULT_CONTEXT_PROTOCOL,
  encodeInitializationParams,
} from './AdminApi';
import { normalizeContextIdForJoin } from './contextIdJoin';
import { markJoinedContextOnNode } from '@/utils/joinedFolderContexts';
import { getGroupMemberIdentity, setGroupMemberIdentity } from '@/constants/config';

function identitiesListIncludes(identities: string[], identity: string): boolean {
  const a = identity.trim();
  return identities.some((x) => {
    const b = x.trim();
    return b === a || b.toLowerCase() === a.toLowerCase();
  });
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  generalContextId: string;
}

/** Mirrors `GroupMemberRole` from the admin API (`Admin` | `Member`). */
export type GroupMemberRole = 'Admin' | 'Member';

export interface MemberInfo {
  identity: string;
  role: GroupMemberRole;
  alias?: string;
}

function parseGroupMemberRole(raw: unknown): GroupMemberRole {
  if (raw === 'Admin') {
    return 'Admin';
  }
  return 'Member';
}

interface GroupSummary {
  groupId: string;
  alias?: string | null;
  targetApplicationId: string;
}

interface GroupContextSummary {
  contextId: string;
  alias?: string | null;
}

/** `data` object from GET /admin-api/groups/:id (camelCase). */
export interface GroupInfo {
  groupId: string;
  appKey: string;
  targetApplicationId: string;
  upgradePolicy: string;
  memberCount: number;
  contextCount: number;
  defaultCapabilities: number;
  defaultVisibility: string;
  alias?: string | null;
  activeUpgrade?: unknown;
}

export class WorkspaceManager {
  constructor(private app: CalimeroApp | null) {}

  async listWorkspaces(activeGroupId?: string | null): Promise<WorkspaceInfo[]> {
    const groups = await adminRequest<GroupSummary[]>('/groups');
    const appGroups = groups.filter(
      (group) => group.targetApplicationId === getApplicationId(),
    );
    const groupToHydrate = activeGroupId ?? appGroups[0]?.groupId ?? null;

    const workspaces = await Promise.all(
      appGroups.map(async (group) => {
        let generalContextId = '';
        if (group.groupId === groupToHydrate) {
          try {
            generalContextId = await this.resolveGeneralContextId(group.groupId);
          } catch {
            // non-blocking: leave generalContextId empty
          }
        }
        return {
          id: group.groupId,
          name: group.alias ?? 'Unnamed',
          generalContextId,
        };
      }),
    );

    return workspaces;
  }

  async resolveGeneralContextId(groupId: string): Promise<string> {
    const contexts = await adminRequest<GroupContextSummary[]>(
      `/groups/${groupId}/contexts`,
    );
    const generalContext =
      contexts.find((context) => context.alias === 'General') ?? contexts[0];

    return generalContext?.contextId ?? '';
  }

  async joinContextViaGroup(groupId: string, contextId: string): Promise<void> {
    const normalized = normalizeContextIdForJoin(contextId);
    await adminRequest<void>(`/groups/${groupId}/join-context`, {
      method: 'POST',
      body: {
        contextId: normalized,
      },
    });
    markJoinedContextOnNode(groupId, contextId);
  }

  /**
   * Resolves the current member identity for this node (same heuristics as useGroupPermissions).
   */
  async resolveMemberIdentityForGroup(
    groupId: string,
    contextIdForOwnedLookup?: string | null,
  ): Promise<string | null> {
    const { members, selfIdentity } = await this.getWorkspaceMembers(groupId);

    if (selfIdentity && members.some((m) => m.identity === selfIdentity)) {
      setGroupMemberIdentity(groupId, selfIdentity);
      return selfIdentity;
    }

    const stored = getGroupMemberIdentity(groupId);
    if (stored && members.some((m) => m.identity === stored)) {
      return stored;
    }

    const hint = contextIdForOwnedLookup;
    if (hint) {
      try {
        const pathId = normalizeContextIdForJoin(hint);
        const data = await adminRequest<{ identities: string[] }>(
          `/contexts/${encodeURIComponent(pathId)}/identities-owned`,
        );
        const match = members.find((m) =>
          identitiesListIncludes(data.identities ?? [], m.identity),
        )?.identity;
        if (match) {
          setGroupMemberIdentity(groupId, match);
          return match;
        }
      } catch {
        // fall through
      }
    }

    if (members.length === 1) {
      return members[0].identity;
    }

    return null;
  }

  /** True when this node's identity appears in identities-owned for the context. */
  async isMemberOfContext(groupId: string, contextId: string): Promise<boolean> {
    let generalContextId = '';
    try {
      generalContextId = await this.resolveGeneralContextId(groupId);
    } catch {
      generalContextId = '';
    }

    let identity: string | null = null;
    try {
      identity = await this.resolveMemberIdentityForGroup(
        groupId,
        generalContextId || contextId,
      );
    } catch {
      return false;
    }
    if (!identity) {
      return false;
    }

    try {
      const pathId = normalizeContextIdForJoin(contextId);
      const data = await adminRequest<{ identities: string[] }>(
        `/contexts/${encodeURIComponent(pathId)}/identities-owned`,
      );
      return identitiesListIncludes(data.identities ?? [], identity);
    } catch {
      return false;
    }
  }

  async createWorkspace(name: string): Promise<WorkspaceInfo> {
    const createGroup = await adminRequest<{ groupId: string }>('/groups', {
      method: 'POST',
      body: {
        applicationId: getApplicationId(),
        upgradePolicy: 'LazyOnAccess',
      },
    });
    const groupId = createGroup.groupId;

    await adminRequest<void>(`/groups/${groupId}/alias`, {
      method: 'PUT',
      body: { alias: name },
    });

    const createContext = await createContextForGroup(groupId, {
      applicationId: getApplicationId(),
      protocol: DEFAULT_CONTEXT_PROTOCOL,
      alias: 'General',
      initializationParams: encodeInitializationParams({}),
    });
    const generalContextId = createContext.contextId;

    if (generalContextId && this.app) {
      try {
        await new AbiClient(this.app, generalContextId).setContextName({ name: 'General' });
      } catch (error) {
        throw new AdminApiError(
          error instanceof Error ? error.message : 'Failed to name the General context.',
          500,
          'server',
          error,
        );
      }

      try {
        await adminRequest<void>(`/groups/${groupId}/contexts/${generalContextId}/visibility`, {
          method: 'PUT',
          body: { mode: 'open' },
        });
      } catch {
        // Non-blocking: older nodes may not support visibility; General still works
      }
    }

    return {
      id: groupId,
      name,
      generalContextId,
    };
  }

  async setWorkspaceName(groupId: string, name: string): Promise<void> {
    await adminRequest<void>(`/groups/${groupId}/alias`, {
      method: 'PUT',
      body: { alias: name },
    });
  }

  async getWorkspaceMembers(groupId: string): Promise<{
    members: MemberInfo[];
    selfIdentity: string | null;
  }> {
    const raw = await adminRequestFull<{
      data?: Array<{ identity: string; role?: unknown; alias?: string | null }>;
      selfIdentity?: string;
    }>(`/groups/${groupId}/members`);

    const list = Array.isArray(raw?.data) ? raw.data : [];
    return {
      members: list.map((m) => ({
        identity: m.identity,
        role: parseGroupMemberRole(m.role),
        alias: m.alias ?? undefined,
      })),
      selfIdentity: raw?.selfIdentity ?? null,
    };
  }

  /** Returns the member capability bitmask (`u32`) for the given identity. */
  async getMemberCapabilities(groupId: string, identity: string): Promise<number> {
    const id = encodeURIComponent(identity);
    const data = await adminRequest<{ capabilities: number }>(
      `/groups/${groupId}/members/${id}/capabilities`,
    );
    return data.capabilities;
  }

  /** Writes a new capability bitmask (`u32`) for the given member. */
  async setMemberCapabilities(
    groupId: string,
    identity: string,
    capabilities: number,
  ): Promise<void> {
    const id = encodeURIComponent(identity);
    await adminRequest<void>(
      `/groups/${groupId}/members/${id}/capabilities`,
      {
        method: 'PUT',
        body: { capabilities },
      },
    );
  }

  async setMemberAlias(groupId: string, identity: string, alias: string): Promise<void> {
    await adminRequest<void>(`/groups/${groupId}/members/${identity}/alias`, {
      method: 'PUT',
      body: { alias },
    });
  }

  async getGroupInfo(groupId: string): Promise<GroupInfo> {
    return adminRequest<GroupInfo>(`/groups/${groupId}`);
  }

  async getDefaultCapabilities(groupId: string): Promise<number> {
    const { defaultCapabilities } = await this.getGroupInfo(groupId);
    return defaultCapabilities;
  }

  async setDefaultCapabilities(groupId: string, capabilities: number): Promise<void> {
    await adminRequest<void>(`/groups/${groupId}/settings/default-capabilities`, {
      method: 'PUT',
      body: { defaultCapabilities: capabilities },
    });
  }

  async getDefaultVisibility(groupId: string): Promise<'open' | 'restricted'> {
    const { defaultVisibility } = await this.getGroupInfo(groupId);
    return defaultVisibility === 'restricted' ? 'restricted' : 'open';
  }

  async setDefaultVisibility(groupId: string, mode: 'open' | 'restricted'): Promise<void> {
    await adminRequest<void>(`/groups/${groupId}/settings/default-visibility`, {
      method: 'PUT',
      body: { defaultVisibility: mode },
    });
  }
}
