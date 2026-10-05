// Promote / demote a member's CORE GROUP ROLE, and keep the registry
// contract's manager list in step with it.
//
// See `lib/roles.ts` for why "in step" is not optional: core admin and
// registry manager are separate grants in separate systems, and a promotion
// that only moves the first produces someone whose badge says Admin and who is
// refused by this app's own contract the moment they touch a folder role.
//
// Three writes, in a deliberate order:
//
//   1. `updateMemberRole`      - the core role, when it moves. Must come
//                                first: its failure means nothing else should
//                                happen.
//   2. `setMemberCapabilities` - when the role's grant names a different
//                                bitmask (see `WORKSPACE_ROLE_GRANTS`). Between
//                                Manager and Editor this is the whole change.
//   3. add/removeManager       - the registry side, and only when this caller
//                                is the registry OWNER, because the contract
//                                permits nobody else to write that list.
//
// Steps 2 and 3 are reported, not thrown, once step 1 has written. The role
// change has already landed by then, and failing the whole call would tell the
// user nothing happened when something did. `warnings` carries what did not
// get done, in the words the user needs to act on it.

import { useCallback, useState } from 'react';
import { useMero, useUpdateMemberRole } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';
import {
  registryManagerIntent,
  roleDisplayLabel,
  WORKSPACE_ROLE_GRANTS,
  type WorkspaceAccessRole,
  type GroupRole,
} from '@/lib/roles';

export interface RoleChangeResult {
  /** The role write succeeded. */
  ok: boolean;
  /**
   * Things that did NOT happen, each already phrased for display. A non-empty
   * list with `ok: true` is the important case: the role moved, and something
   * the role implies did not.
   */
  warnings: string[];
}

export interface GroupRoleAdmin {
  setRole: (
    memberAccount: string,
    nextRole: WorkspaceAccessRole,
    currentCaps: number | null,
    currentRole: GroupRole,
  ) => Promise<RoleChangeResult>;
  saving: boolean;
}

/**
 * @param groupId the core group whose membership is being edited - a namespace
 *   root id for the workspace roster, a folder's subgroup id for a folder one.
 * @param syncRegistryManagers whether an Admin promotion here should also
 *   appoint a registry manager. True for the NAMESPACE roster, where "admin of
 *   this workspace" is the claim being made. False for a folder roster: the
 *   registry's manager list is workspace-wide, so granting it from a folder
 *   would quietly widen someone's reach far beyond the folder in front of
 *   them.
 */
export function useGroupRoleAdmin(
  groupId: string | null,
  syncRegistryManagers: boolean,
): GroupRoleAdmin {
  const { admin } = useMero();
  const { updateMemberRole } = useUpdateMemberRole();
  const { registryAdmin } = useDriveWorkspace();
  const [saving, setSaving] = useState(false);

  const setRole = useCallback(
    async (
      memberAccount: string,
      nextRole: WorkspaceAccessRole,
      currentCaps: number | null,
      currentRole: GroupRole,
    ): Promise<RoleChangeResult> => {
      if (!groupId) throw new Error('No group selected');
      if (!admin) throw new Error('Mero client not ready');
      setSaving(true);
      const warnings: string[] = [];
      try {
        // ⚠️ `memberAccount` is an ACCOUNT (64 hex), as `listGroupMembers`
        // returns and `useNodeIdentity().identity.accountId` gives for
        // oneself. A signing key or a device id is also 64 hex and would be
        // accepted here and by the server, naming a principal that exists
        // nowhere - no error, no effect.
        const grant = WORKSPACE_ROLE_GRANTS[nextRole];
        const roleMoves = grant.role !== currentRole;
        if (roleMoves) {
          await updateMemberRole(groupId, memberAccount, { role: grant.role });
        }

        if (grant.caps !== null && grant.caps !== currentCaps) {
          try {
            await admin.setMemberCapabilities(groupId, memberAccount, {
              capabilities: grant.caps,
            });
          } catch (e: unknown) {
            if (!roleMoves) throw e;
            const msg = e instanceof Error ? e.message : String(e);
            warnings.push(
              nextRole === 'Guest'
                ? `Role set to ${roleDisplayLabel(nextRole)}, but their existing permissions could not be cleared (${msg}). They may still be able to make changes.`
                : `Role set to ${roleDisplayLabel(nextRole)}, but their permissions could not be set (${msg}). They may not be able to do anything until you pick the role again.`,
            );
          }
        }

        if (syncRegistryManagers) {
          const intent = registryManagerIntent(currentRole, grant.role);
          if (intent !== 'none') {
            if (!registryAdmin.isOwner) {
              // Not a failure of this call - the contract permits only the
              // owner to write that list. Say what is missing so the user
              // knows who to ask rather than discovering it as a refusal
              // later, from the promoted person.
              warnings.push(
                intent === 'add'
                  ? 'They are a workspace admin, but only the workspace owner can let them set folder roles. Ask the owner to add them under Settings → People who can set folder roles.'
                  : 'They are no longer a workspace admin, but only the workspace owner can stop them setting folder roles. Ask the owner to remove them under Settings → People who can set folder roles.',
              );
            } else {
              try {
                if (intent === 'add') {
                  await registryAdmin.addManager(memberAccount);
                } else {
                  await registryAdmin.removeManager(memberAccount);
                }
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                warnings.push(
                  intent === 'add'
                    ? `Role updated, but they could not be added to the people who can set folder roles (${msg}).`
                    : `Role updated, but they could not be removed from the people who can set folder roles (${msg}).`,
                );
              }
            }
          }
        }

        return { ok: true, warnings };
      } finally {
        setSaving(false);
      }
    },
    [groupId, admin, updateMemberRole, registryAdmin, syncRegistryManagers],
  );

  return { setRole, saving };
}
