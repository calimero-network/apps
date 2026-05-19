// Toggle a folder's subgroup visibility between Open and Restricted.
// Gated by canManageVisibility (core's CAN_MANAGE_VISIBILITY bit) —
// only folder admins see the option.
//
// As of core PR #2261, visibility is owned by Calimero core, not the
// app-layer registry. Open subgroups inherit membership from the
// parent namespace via core's parent-walk; Restricted subgroups
// require explicit invites. We call mero.admin.setSubgroupVisibility
// (via the useSetSubgroupVisibility hook) rather than the old
// registry.setVisibility — the registry no longer carries this field.

import React, { useState } from 'react';
import { useSetSubgroupVisibility } from '@calimero-network/mero-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Eye, EyeOff } from 'lucide-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';

interface Props {
  folderId: string;
  /** Current subgroup visibility from core's GroupInfo. `undefined`
   *  while the per-folder fetch is still in flight — the toggle
   *  hides itself until a real value lands so an unintended click
   *  can't flip a folder to the wrong mode. */
  current: 'Open' | 'Restricted' | undefined;
  onError?: (err: Error) => void;
}

export function FolderVisibilityToggle({ folderId, current, onError }: Props) {
  const { namespaceId, refetch } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { setSubgroupVisibility } = useSetSubgroupVisibility();
  const [busy, setBusy] = useState(false);

  if (!perms.canManageVisibility || !current) return null;

  const next: 'Open' | 'Restricted' = current === 'Open' ? 'Restricted' : 'Open';

  const onToggle = async () => {
    setBusy(true);
    try {
      // Core expects lowercase `"open"` / `"restricted"`; see
      // `crates/server/src/admin/handlers/groups/set_subgroup_visibility.rs:31`
      // — capitalized values return 400 Bad Request. The frontend's
      // GroupInfo round-trip uses capitalized values for display, so
      // lowercase only at the wire boundary (same pattern as
      // useFolderOperations.create).
      await setSubgroupVisibility(folderId, {
        subgroupVisibility: next.toLowerCase(),
      });
      await refetch();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenuItem onClick={onToggle} disabled={busy}>
      {current === 'Open' ? (
        <>
          <EyeOff className="mr-2 h-4 w-4" />
          Make restricted
        </>
      ) : (
        <>
          <Eye className="mr-2 h-4 w-4" />
          Make open
        </>
      )}
    </DropdownMenuItem>
  );
}
