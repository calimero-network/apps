/**
 * Roles and capabilities in the active workspace (an org), with the writes the
 * Members page makes. Every write is a passkey step-up on Calimero 1.0
 * (`setMember`, `removeMember`, `setCapabilities` answer 412 CONFIRM_REQUIRED
 * and mero-js asks for the passkey), and every write is followed by a
 * read-back, so a change the node refused never looks like one it accepted.
 */
import { useCallback, useMemo } from 'react';
import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';

import {
  ROLE_ADMIN,
  ROLE_MEMBER,
  canCreatePipeline,
  canInvite as canInviteWith,
  canManageMembers as canManageWith,
  effectiveCapabilities,
  normaliseRole,
  repairedDefault,
  type WorkspaceRole,
} from '../utils/roles';
import type { OrgMembers } from '../workspaces';

export interface UseMemberRolesReturn {
  /** account -> its role as the screens show it (`Admin` / `Member`). */
  roles: Map<string, string>;
  /** account -> the org's own role (`owner`, `admin`, `member`, `guest`). */
  orgRoles: Map<string, string>;
  /** account -> per-member capability override. Absent means "none set". */
  overrides: Map<string, number>;
  /** The org's `defaultCapabilities`, or null until it has been read. */
  defaultCapabilities: number | null;
  myRole: WorkspaceRole;
  canManageMembers: boolean;
  canAddPipeline: boolean;
  canInvite: boolean;
  /** Promote to Admin / demote to Member. Refetches before returning. */
  setRole: (account: string, role: WorkspaceRole) => Promise<void>;
  /** Write an explicit per-member capability override. */
  setCapabilities: (account: string, capabilities: number) => Promise<void>;
  removeMember: (account: string) => Promise<void>;
  /** Grant the app's baseline to every member without an override. */
  repairDefaultCapabilities: () => Promise<void>;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useMemberRoles({
  client,
  org,
  self,
  state,
  refetch,
  passkey,
  after,
}: {
  client: Pick<CalimeroClient, 'setMember' | 'removeMember' | 'setCapabilities'>;
  org: string | null;
  self: string;
  state: OrgMembers | null;
  refetch: () => Promise<void>;
  passkey: () => PasskeyProvider;
  after: () => void;
}): UseMemberRolesReturn {
  const orgRoles = useMemo(() => state?.roles ?? new Map<string, string>(), [state]);
  const roles = useMemo(
    () => new Map(Array.from(orgRoles, ([account, role]) => [account, normaliseRole(role)])),
    [orgRoles],
  );
  const overrides = useMemo(() => state?.overrides ?? new Map<string, number>(), [state]);
  const defaultCapabilities = state?.defaultCapabilities ?? null;

  const mine = { role: roles.get(self), override: overrides.get(self), groupDefault: defaultCapabilities };

  const write = useCallback(
    async (op: (org: string) => Promise<unknown>) => {
      if (!org) return;
      try {
        await op(org);
      } finally {
        after();
      }
      await refetch();
    },
    [org, refetch, after],
  );

  const setRole = useCallback(
    (account: string, role: WorkspaceRole) =>
      write((o) => client.setMember(o, account, role === ROLE_ADMIN ? 'admin' : 'member', passkey())),
    [client, passkey, write],
  );
  const setCapabilities = useCallback(
    (account: string, capabilities: number) =>
      write((o) => client.setCapabilities(o, capabilities, passkey(), { account })),
    [client, passkey, write],
  );
  const removeMember = useCallback(
    (account: string) => write((o) => client.removeMember(o, account, passkey())),
    [client, passkey, write],
  );
  const repairDefaultCapabilities = useCallback(
    () => write((o) => client.setCapabilities(o, repairedDefault(defaultCapabilities), passkey())),
    [client, passkey, write, defaultCapabilities],
  );

  return {
    roles,
    orgRoles,
    overrides,
    defaultCapabilities,
    myRole: normaliseRole(mine.role),
    canManageMembers: canManageWith(mine),
    canAddPipeline: canCreatePipeline(mine),
    canInvite: canInviteWith(mine),
    setRole,
    setCapabilities,
    removeMember,
    repairDefaultCapabilities,
    loading: state === null,
    refetch,
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
