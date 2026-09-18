/**
 * Roles and capabilities for the members of the active workspace.
 *
 * Everything here is keyed by a member's ACCOUNT (`GroupMember.identity`, and
 * `useNodeIdentity().identity.accountId` for yourself). A context executor key
 * is also 64 hex and passing one to these endpoints type-checks, reaches the
 * node, and authorises a principal that exists nowhere — see `utils/roles`.
 *
 * Reads are deliberately read-BACK: every mutation refetches from the node
 * rather than patching local state. A promotion the node refused (a member
 * without MANAGE_MEMBERS trying to promote) otherwise looks exactly like one it
 * accepted, which is the difference between "this works" and "this appears to
 * work in the promoter's browser".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-js';
import {
  ROLE_ADMIN,
  ROLE_MEMBER,
  type WorkspaceRole,
  canCreateRepo as canCreate,
  canInvite as canInviteFn,
  canManageMembers as canManage,
  effectiveCapabilities,
  repairedDefault,
} from '../utils/roles';

export interface UseMemberRolesReturn {
  /** account -> `GroupMember.role`. */
  roles: Map<string, string>;
  /** account -> per-member capability OVERRIDE. 0 means "none set". */
  overrides: Map<string, number>;
  /** The group's `defaultCapabilities`, or null until it has been read. */
  defaultCapabilities: number | null;
  /** The signed-in member's role in this workspace. */
  myRole: WorkspaceRole;
  /** True when the signed-in member may promote/demote others. */
  canManageMembers: boolean;
  /** True when the signed-in member may add a repo (create a context) here. */
  canAddRepo: boolean;
  /** True when the signed-in member may invite people to this workspace. */
  canInvite: boolean;
  /** Promote to Admin / demote to Member. Refetches before returning. */
  setRole: (account: string, role: WorkspaceRole) => Promise<void>;
  /** Write an explicit per-member capability override. */
  setCapabilities: (account: string, capabilities: number) => Promise<void>;
  /** Grant the app's baseline to every FUTURE member of this workspace. */
  repairDefaultCapabilities: () => Promise<void>;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useMemberRoles(
  namespaceId: string | null,
  members: GroupMember[],
  selfAccount: string | null,
): UseMemberRolesReturn {
  const { mero } = useMero();
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [defaultCapabilities, setDefaultCapabilities] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const roles = useMemo(
    () => new Map(members.map((m) => [m.identity, m.role])),
    [members],
  );

  // Keyed off the ACCOUNT ids rather than the array: `useGroupMembers` hands
  // back a fresh array on every refetch, and this would otherwise re-read every
  // member's capabilities on each one.
  const accountsKey = useMemo(
    () => members.map((m) => m.identity).sort().join(','),
    [members],
  );

  const load = useCallback(async () => {
    if (!mero || !namespaceId) {
      setOverrides(new Map());
      setDefaultCapabilities(null);
      return;
    }
    const accounts = accountsKey ? accountsKey.split(',') : [];
    setLoading(true);
    try {
      const [groupDefault, entries] = await Promise.all([
        // A thin read over getGroupInfo. Null rather than 0 on failure: 0 is a
        // real value meaning "members may do nothing", and showing that when we
        // simply could not read would offer a repair for a problem that is not
        // there.
        mero.admin.getDefaultCapabilities(namespaceId).catch(() => null),
        Promise.all(
          accounts.map(async (account) => {
            const caps = await mero.admin
              .getMemberCapabilities(namespaceId, account)
              .catch(() => null);
            return [account, caps?.capabilities ?? 0] as const;
          }),
        ),
      ]);
      setDefaultCapabilities(groupDefault);
      setOverrides(new Map(entries));
    } finally {
      setLoading(false);
    }
  }, [mero, namespaceId, accountsKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  const myRole: WorkspaceRole = useMemo(() => {
    const role = selfAccount ? roles.get(selfAccount) : null;
    return role && role.trim().toLowerCase() === 'admin' ? ROLE_ADMIN : ROLE_MEMBER;
  }, [roles, selfAccount]);

  // One description of "me", fed to each of the three questions — so a change to
  // how effective permissions are computed cannot answer them inconsistently.
  const selfInput = useMemo(
    () => ({
      role: selfAccount ? roles.get(selfAccount) : null,
      override: selfAccount ? overrides.get(selfAccount) : 0,
      groupDefault: defaultCapabilities,
    }),
    [selfAccount, roles, overrides, defaultCapabilities],
  );

  const canManageMembers = useMemo(
    () => (selfAccount ? canManage(selfInput) : false),
    [selfAccount, selfInput],
  );
  const canAddRepo = useMemo(
    () => (selfAccount ? canCreate(selfInput) : false),
    [selfAccount, selfInput],
  );
  const canInvite = useMemo(
    () => (selfAccount ? canInviteFn(selfInput) : false),
    [selfAccount, selfInput],
  );

  const setRole = useCallback(
    async (account: string, role: WorkspaceRole) => {
      if (!mero || !namespaceId) throw new Error('Workspace not ready');
      // ROLE ONLY. `Admin` bypasses the capability mask, so writing a mask here
      // would grant nothing — and it would survive a later demote, silently
      // leaving an ex-admin with an admin's bits. See `utils/roles`.
      await mero.admin.updateMemberRole(namespaceId, account, { role });
      await load();
    },
    [mero, namespaceId, load],
  );

  const setCapabilities = useCallback(
    async (account: string, capabilities: number) => {
      if (!mero || !namespaceId) throw new Error('Workspace not ready');
      await mero.admin.setMemberCapabilities(namespaceId, account, { capabilities });
      await load();
    },
    [mero, namespaceId, load],
  );

  const repairDefaultCapabilities = useCallback(async () => {
    if (!mero || !namespaceId) throw new Error('Workspace not ready');
    await mero.admin.setDefaultCapabilities(namespaceId, {
      defaultCapabilities: repairedDefault(defaultCapabilities),
    });
    await load();
  }, [mero, namespaceId, defaultCapabilities, load]);

  return {
    roles,
    overrides,
    defaultCapabilities,
    myRole,
    canManageMembers,
    canAddRepo,
    canInvite,
    setRole,
    setCapabilities,
    repairDefaultCapabilities,
    loading,
    refetch: load,
  };
}

/** The effective mask for one account, from the three inputs that decide it. */
export function effectiveFor(
  account: string,
  state: Pick<UseMemberRolesReturn, 'roles' | 'overrides' | 'defaultCapabilities'>,
): number {
  return effectiveCapabilities({
    role: state.roles.get(account),
    override: state.overrides.get(account),
    groupDefault: state.defaultCapabilities,
  });
}

export { ROLE_ADMIN, ROLE_MEMBER };
