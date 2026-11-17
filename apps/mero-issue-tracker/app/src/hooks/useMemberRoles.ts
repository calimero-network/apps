/**
 * Roles and capabilities in the active workspace (an org), with the writes the
 * Members page makes. Every write is a passkey step-up on Calimero 1.0
 * (`setMember`, `removeMember`, `setCapabilities` answer 412 CONFIRM_REQUIRED
 * and mero-js asks for the passkey), and every write is followed by a
 * read-back, so a change the node refused never looks like one it accepted.
 * On a session bound to the app's frontend the organization-wide ones (a role,
 * permissions, the defaults) go to the node's consent page (`orgConsent.ts`).
 */
import { useCallback, useMemo } from 'react';
import type { CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import type { AppSource, ClientRoutes, ConsentClient, MaybeMe } from '@calimero-apps/connect';

import {
  ROLE_ADMIN,
  ROLE_MEMBER,
  canCreateRepo,
  canInvite as canInviteWith,
  canManageMembers as canManageWith,
  effectiveCapabilities,
  normaliseRole,
  repairedDefault,
  type WorkspaceRole,
} from '../utils/roles';
import { removeFromWorkspace, type OrgMembers } from '../workspaces';
import { setOrgCapabilities, setOrgRole } from '../orgConsent';

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
  canAddRepo: boolean;
  canInvite: boolean;
  /** Promote to Admin / demote to Member. Refetches before returning. */
  setRole: (account: string, role: WorkspaceRole) => Promise<void>;
  /** Write an explicit per-member capability override. */
  setCapabilities: (account: string, capabilities: number) => Promise<void>;
  /**
   * Out of the workspace: off this app's team where the org has one, never
   * out of the org; in an org without one (legacy), out of the org.
   */
  removeMember: (account: string) => Promise<void>;
  /** The org keeps its apps apart and this one has its team (Remove is this app's only). */
  appOnly: boolean;
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
  source = null,
}: {
  client: ClientRoutes<{ orgs: 'setMember' | 'removeMember' | 'teamRemoveMember' | 'get' | 'capabilities' }> &
    Pick<CalimeroClient, 'session'> &
    MaybeMe &
    ConsentClient;
  org: string | null;
  self: string;
  state: OrgMembers | null;
  refetch: () => Promise<void>;
  passkey: () => PasskeyProvider;
  after: () => void;
  source?: AppSource | null;
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
      write((o) => setOrgRole(client, o, account, role === ROLE_ADMIN ? 'admin' : 'member', passkey)),
    [client, passkey, write],
  );
  const setCapabilities = useCallback(
    (account: string, capabilities: number) =>
      write((o) => setOrgCapabilities(client, o, capabilities, passkey, account)),
    [client, passkey, write],
  );
  const removeMember = useCallback(
    (account: string) => write((o) => removeFromWorkspace(client, o, source, account, passkey)),
    [client, passkey, write, source],
  );
  const repairDefaultCapabilities = useCallback(
    () =>
      write((o) => setOrgCapabilities(client, o, repairedDefault(defaultCapabilities), passkey)),
    [client, passkey, write, defaultCapabilities],
  );

  return {
    roles,
    orgRoles,
    overrides,
    defaultCapabilities,
    myRole: normaliseRole(mine.role),
    canManageMembers: canManageWith(mine),
    canAddRepo: canCreateRepo(mine),
    canInvite: canInviteWith(mine),
    setRole,
    setCapabilities,
    removeMember,
    appOnly: state?.appOnly ?? false,
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
