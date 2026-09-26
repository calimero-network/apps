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
//   1. `updateMemberRole`      — the core role. Must come first: it is the one
//                                the user asked for, and the one whose failure
//                                means nothing else should happen.
//   2. `setMemberCapabilities` — only when the new role implies a bitmask
//                                change (see `capabilitiesForRole`). Skipped
//                                for a promotion to Admin, where the bitmask
//                                is not consulted.
//   3. add/removeManager       — the registry side, and only when this caller
//                                is the registry OWNER, because the contract
//                                permits nobody else to write that list.
//
// Steps 2 and 3 are reported, not thrown. The role change has already landed
// by then, and failing the whole call would tell the user nothing happened
// when something did. `warnings` carries what did not get done, in the words
// the user needs to act on it.

import { useCallback, useState } from 'react';
import { useMero, useUpdateMemberRole } from '@calimero-network/mero-react';
import { useDriveWorkspace } from './useDriveWorkspace';
import {
  capabilitiesForRole,
  registryManagerIntent,
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
    nextRole: GroupRole,
    currentCaps: number | null,
    currentRole: GroupRole,
  ) => Promise<RoleChangeResult>;
  saving: boolean;
}

/**
 * @param groupId the core group whose membership is being edited — a namespace
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
  const { mero } = useMero();
  const { updateMemberRole } = useUpdateMemberRole();
  const { registryAdmin } = useDriveWorkspace();
  const [saving, setSaving] = useState(false);

  const setRole = useCallback(
    async (
      memberAccount: string,
      nextRole: GroupRole,
      currentCaps: number | null,
      currentRole: GroupRole,
    ): Promise<RoleChangeResult> => {
      if (!groupId) throw new Error('No group selected');
      if (!mero) throw new Error('Mero client not ready');
      setSaving(true);
      const warnings: string[] = [];
      try {
        // ⚠️ `memberAccount` is an ACCOUNT (64 hex), as `listGroupMembers`
        // returns and `useNodeIdentity().identity.accountId` gives for
        // oneself. A signing key or a device id is also 64 hex and would be
        // accepted here and by the server, naming a principal that exists
        // nowhere — no error, no effect.
        await updateMemberRole(groupId, memberAccount, { role: nextRole });

        const nextCaps = capabilitiesForRole(nextRole, currentCaps);
        if (nextCaps !== null) {
          try {
            await mero.admin.setMemberCapabilities(groupId, memberAccount, {
              capabilities: nextCaps,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            warnings.push(
              nextRole === 'ReadOnly'
                ? `Role set to ReadOnly, but their existing permissions could not be cleared (${msg}). They may still be able to make changes.`
                : `Role set to ${nextRole}, but their permissions could not be set (${msg}). They may not be able to do anything until a permission preset is applied.`,
            );
          }
        }

        if (syncRegistryManagers) {
          const intent = registryManagerIntent(currentRole, nextRole);
          if (intent !== 'none') {
            if (!registryAdmin.isOwner) {
              // Not a failure of this call — the contract permits only the
              // owner to write that list. Say what is missing so the user
              // knows who to ask rather than discovering it as a refusal
              // later, from the promoted person.
              warnings.push(
                intent === 'add'
                  ? 'They are a workspace admin, but only the workspace owner can let them manage folder permissions. Ask the owner to add them under Settings → Managers.'
                  : 'They are no longer a workspace admin, but only the workspace owner can revoke their folder-permission management. Ask the owner to remove them under Settings → Managers.',
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
                    ? `Role updated, but they could not be added as a folder-permission manager (${msg}).`
                    : `Role updated, but their folder-permission management could not be revoked (${msg}).`,
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
    [groupId, mero, updateMemberRole, registryAdmin, syncRegistryManagers],
  );

  return { setRole, saving };
}
