// Toggle a folder's subgroup visibility between Open and Restricted.
// Gated by canManageVisibility (core's CAN_MANAGE_VISIBILITY bit) -
// only folder admins see the option.
//
// Visibility is owned by Calimero core, not the
// app-layer registry. Open subgroups inherit membership from the
// parent namespace via core's parent-walk; Restricted subgroups
// require explicit invites. We call mero.admin.setSubgroupVisibility
// (via the useSetSubgroupVisibility hook) rather than the old
// registry.setVisibility - the registry no longer carries this field.

import React, { useState } from 'react';
import { useMero, useSetSubgroupVisibility } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Eye, EyeOff } from 'lucide-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { inheritReadOnly } from '@/lib/applyFolderRole';

const READ_ONLY_NOT_CARRIED =
  "Opened, but the parent folder's Read only members could not be made Read only here.";

interface Props {
  folderId: string;
  /** Current subgroup visibility from core's GroupInfo. `undefined`
   *  while the per-folder fetch is still in flight - the toggle
   *  hides itself until a real value lands so an unintended click
   *  can't flip a folder to the wrong mode. */
  current: 'Open' | 'Restricted' | undefined;
  onError?: (err: Error) => void;
}

export function FolderVisibilityToggle({ folderId, current, onError }: Props) {
  const { namespaceId, refetch, folders, registryClient } = useDriveWorkspace();
  const { mero } = useMero();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { setSubgroupVisibility } = useSetSubgroupVisibility();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  if (!perms.canManageVisibility || !current) return null;

  const next: 'Open' | 'Restricted' = current === 'Open' ? 'Restricted' : 'Open';

  const onToggle = async () => {
    // Restricting revokes everyone who only had inherited access; opening takes nothing away.
    if (
      next === 'Restricted' &&
      !(await confirm({
        title: 'Make this folder restricted?',
        body: 'Workspace members you have not added will lose access to this folder and its subfolders.',
        confirmLabel: 'Make restricted',
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      // Core expects lowercase `"open"` / `"restricted"`; see
      // `crates/server/src/admin/handlers/groups/set_subgroup_visibility.rs:31`
      // - capitalized values return 400 Bad Request. The frontend's
      // GroupInfo round-trip uses capitalized values for display, so
      // lowercase only at the wire boundary (same pattern as
      // useFolderOperations.create).
      await setSubgroupVisibility(folderId, {
        subgroupVisibility: next.toLowerCase(),
      });
      const parent = folders.find((f) => f.id === folderId)?.parent_id;
      const failed =
        next === 'Open' && parent && mero && registryClient
          ? await inheritReadOnly({ admin: mero.admin, registry: registryClient }, parent, folderId)
          : [];
      await refetch();
      if (failed.length > 0) onError?.(new Error(READ_ONLY_NOT_CARRIED));
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={onToggle}
      disabled={busy}
    >
      {current === 'Open' ? (
        <>
          <EyeOff className="h-3.5 w-3.5" />
          Make restricted
        </>
      ) : (
        <>
          <Eye className="h-3.5 w-3.5" />
          Make open
        </>
      )}
    </Button>
  );
}
