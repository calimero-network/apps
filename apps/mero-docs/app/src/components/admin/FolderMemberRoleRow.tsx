// One member row inside FolderSharingPanel: name, one RoleSelect bound to
// the member's (core role, registry Role, folder caps), and an optional remove
// button. Picking a role writes all three (see FOLDER_ROLE_GRANTS), the core
// role first because it is the one core enforces. A core Admin (the folder's
// owner) or a TEE node shows as such and cannot be changed here.
//
// Permission-gating lives on the parent panel; this component trusts
// `canManage` for "is the dropdown / remove button interactive".

import React, { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { HTTPError } from '@calimero-network/mero-js';
import { useGroupCapabilities, useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { MemberLabel, UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { useMemberName } from '@/hooks/useMemberName';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { RoleSelect } from './RoleSelect';
import {
  describeRoleChange,
  folderRoleOf,
  FOLDER_ROLE_GRANTS,
  FOLDER_ROLES,
  isTeeRole,
  parseGroupRole,
  roleDisplayLabel,
  type FolderAccessRole,
  type GroupRole,
} from '@/lib/roles';
// `FolderId`/`ContextId` are BRANDED at abi-codegen 2: `string & {__brand}`.
// The generated constructor is the only way to make one, which is the point -
// this fleet has had folder ids, context ids and account ids all be bare 64-hex
// strings that type-check in each other's slots.
import { FolderId } from '@/generated/registry/RegistryClient';
import type { Role } from '@/generated/registry/RegistryClient';

interface Props {
  folderId: string;
  identity: string;
  /** Server-reported core role: Admin / Member / ReadOnly. */
  coreRole?: string;
  /** Registry folder Role for this member (default 'Editor' if absent). */
  registryRole: Role;
  /** True when this row is the caller's own identity - surfaces a
   *  "(you)" badge after the display name. */
  isSelf?: boolean;
  canManage: boolean;
  /** Called after the role's registry role + folder caps are both
   *  written, so the parent can refetch the role list. */
  onAfterRoleChange?: () => void;
  /** Remove this member from the folder. Undefined hides the button. */
  onRemove?: (identity: string) => void;
  removing?: boolean;
}

export function FolderMemberRoleRow({
  folderId,
  identity,
  coreRole,
  registryRole,
  isSelf,
  canManage,
  onAfterRoleChange,
  onRemove,
  removing,
}: Props) {
  const { mero } = useMero();
  const { registryClient, registryContextId, namespaceId } =
    useDriveWorkspace();
  const caps = useGroupCapabilities(folderId, identity);
  const { name, settled } = useMemberName(namespaceId, identity);
  // Null while the name loads, so labels never call a named member unnamed.
  const label = name ?? (settled ? UNNAMED_MEMBER_LABEL : null);
  const confirm = useConfirm();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Caps change without a context event; the registry's sync run is the tick.
  //
  // Depend on `caps.refetch` (the stable useCallback inside
  // mero-react's useGroupCapabilities), NOT the whole `caps`
  // object - mero-react returns a fresh object literal each
  // render, which would otherwise churn the SSE handler identity.
  const capsRefetch = caps.refetch;
  const onCapsEvent = useCallback(() => {
    void capsRefetch();
  }, [capsRefetch]);
  useContextEvents(registryContextId, onCapsEvent, { strict: true });

  // While loading OR on a caps-fetch error, keep the role unknown: a stand-in
  // `0` would read as Read only or Editor and let a change overwrite real caps.
  const core = parseGroupRole(coreRole);
  const current = folderRoleOf(
    core,
    registryRole,
    caps.loading || caps.error ? null : (caps.capabilities ?? null),
  );

  // `identity` is the member's account, which is what core keys group rows by.
  const setCoreRole = async (role: GroupRole) => {
    if (!mero) throw new Error('Mero client not ready');
    try {
      await mero.admin.updateMemberRole(folderId, identity, { role });
    } catch (e: unknown) {
      // A member who only inherits an Open folder has no direct row to update.
      if (!(e instanceof HTTPError && e.status === 404)) throw e;
      await mero.admin.addGroupMembers(folderId, { members: [{ identity, role }] });
    }
  };

  const onRoleChange = async (next: FolderAccessRole) => {
    if (!registryClient) {
      setUpdateError('Workspace not ready');
      return;
    }
    if (!current) return;
    const ok = await confirm({
      title: label
        ? `Change ${label}'s role to ${roleDisplayLabel(next)}?`
        : `Change role to ${roleDisplayLabel(next)}?`,
      body: describeRoleChange(current, next, 'folder'),
      confirmLabel: 'Change role',
      destructive: true,
    });
    if (!ok) return;
    const grant = FOLDER_ROLE_GRANTS[next];
    setUpdating(true);
    setUpdateError(null);
    try {
      if (grant.coreRole !== core) await setCoreRole(grant.coreRole);
      await registryClient.setFolderRole({
        folder_id: FolderId(folderId),
        member: identity,
        role: grant.role,
      });
      await caps.setCapabilities(grant.folderCaps);
      // `useGroupCapabilities.setCapabilities` resolves with the new
      // bitmask but mero-react does NOT necessarily update the hook's
      // own `capabilities` state until the next read - and the
      // RoleSelect's current role derives from that value.
      // Explicitly refetching keeps the dropdown label honest after
      // the write lands.
      await caps.refetch();
      onAfterRoleChange?.();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setUpdateError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            <MemberLabel
              namespaceId={namespaceId}
              memberId={identity}
              isSelf={isSelf}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RoleSelect
            value={current}
            options={FOLDER_ROLES}
            onChange={(next) => {
              void onRoleChange(next);
            }}
            disabled={!canManage || updating || core === 'Admin' || isTeeRole(core)}
            ariaLabel={label ? `Role for ${label}` : 'Member role'}
          />
          {onRemove && canManage ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={removing}
              aria-label={label ? `Remove ${label}` : 'Remove member'}
              onClick={() => onRemove(identity)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <span aria-hidden data-testid="remove-slot" className="h-7 w-7 shrink-0" />
          )}
        </div>
      </div>
      {updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Role update failed: {updateError}
        </p>
      )}
      {caps.error && !updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Couldn't load folder caps: {caps.error.message}
        </p>
      )}
    </li>
  );
}
