// One member row inside FolderSharingPanel: name, one RoleSelect bound to
// the member's core role and folder caps, and an optional remove button.
// Picking a role writes both (see FOLDER_ROLE_GRANTS), the core role first
// because it is the one core enforces. A core Admin (the folder's
// owner) or a TEE node shows as such and cannot be changed here.
//
// Permission-gating lives on the parent panel; this component trusts
// `canManage` for "is the dropdown / remove button interactive".

import React, { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
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
  FOLDER_ROLES,
  isTeeRole,
  parseGroupRole,
  roleDisplayLabel,
  type FolderAccessRole,
} from '@/lib/roles';
import { applyAcross, applyFolderGrant, coreRoleIn } from '@/lib/applyFolderRole';
import { folderNames } from '@/lib/folderLabel';
import { openConnected } from '@/utils/ancestry';

const PARENT_READ_ONLY = 'Read only here comes from a parent folder. Change it there.'; // no row here to change

interface Props {
  folderId: string;
  identity: string;
  /** Server-reported core role: Admin / Member / ReadOnly. */
  coreRole?: string;
  /** True when this row is the caller's own identity - surfaces a
   *  "(you)" badge after the display name. */
  isSelf?: boolean;
  canManage: boolean;
  /** Called after the role and folder caps are written, so the parent can
   *  refetch the member list. */
  onAfterRoleChange?: () => void;
  /** Remove this member from the folder. Undefined hides the button. */
  onRemove?: (identity: string) => void;
  removing?: boolean;
}

export function FolderMemberRoleRow({
  folderId,
  identity,
  coreRole,
  isSelf,
  canManage,
  onAfterRoleChange,
  onRemove,
  removing,
}: Props) {
  const { admin } = useMero();
  const { registryContextId, namespaceId, folders } = useDriveWorkspace();
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
    caps.loading || caps.error ? null : (caps.capabilities ?? null),
  );

  const applyRole = async (next: FolderAccessRole) => {
    if (!admin) {
      setUpdateError('Workspace not ready');
      return;
    }
    // `identity` is the member's account, which is what core keys group rows by.
    const writer = { admin };
    const readOnly = next === 'ReadOnly';
    setUpdating(true);
    setUpdateError(null);
    try {
      // A parent's Read only covers this Open folder, row here or not.
      const here = folders.find((f) => f.id === folderId);
      const underReadOnly =
        !readOnly &&
        here?.visibility === 'Open' &&
        !!here.parent_id &&
        (await coreRoleIn(writer, here.parent_id, identity)) === 'ReadOnly';
      if (underReadOnly || !(await applyFolderGrant(writer, folderId, identity, next, core))) {
        setUpdateError(PARENT_READ_ONLY);
        return;
      }
      // Read only covers the Open sub-folders reached through this one, so its
      // start and its end carry down.
      if (readOnly || core === 'ReadOnly') {
        const { open, unknown } = openConnected(folders, folderId);
        const failed = [...unknown, ...(await applyAcross(writer, open, identity, readOnly))];
        if (failed.length > 0) setUpdateError(subtreeFailure(failed));
      }
      await caps.refetch();
      onAfterRoleChange?.();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setUpdateError(`Role update failed: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const subtreeFailure = (failed: string[]) =>
    `Role set here, but not in ${folderNames(folders, failed)}. Ask the owner of each to set it.`;

  const onRoleChange = async (next: FolderAccessRole) => {
    if (!current) return;
    const ok = await confirm({
      title: label
        ? `Change ${label}'s role to ${roleDisplayLabel(next)}?`
        : `Change role to ${roleDisplayLabel(next)}?`,
      body: describeRoleChange(current, next, 'folder'),
      confirmLabel: 'Change role',
      destructive: true,
    });
    if (ok) await applyRole(next);
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
          {updateError}
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
