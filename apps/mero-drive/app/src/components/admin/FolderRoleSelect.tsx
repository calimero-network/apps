// Per-folder role-preset dropdown — the *folder-scope* analogue of
// MemberRoleSelect. A member assigned via this control gets a registry
// `Role` (Viewer / Editor / Manager) plus a standardised set of
// folder-scope core capability bits:
//
//   Viewer  → Role.Viewer,  no folder caps  (read-only on docs)
//   Editor  → Role.Editor,  no folder caps  (edit docs; the default)
//   Manager → Role.Manager, CAN_INVITE_MEMBERS | MANAGE_MEMBERS |
//             CAN_MANAGE_VISIBILITY | CAN_DELETE_SUBGROUP |
//             CAN_MANAGE_METADATA  (folder-admin)
//
// Any (role, folderCaps) pair that doesn't match a preset is shown as
// "Custom" (read-only via this UI). Selecting a preset calls
// `onChange(preset)`; the caller is responsible for writing BOTH the
// registry role (`setFolderRole`) and the folder caps
// (`useGroupCapabilities().setCapabilities`).
//
// "Admin" (the core group-admin role) isn't a preset here — it bypasses
// both the bitmask and the registry Role on the server, so a dropdown
// option for it would be misleading. The caller renders an "All
// permissions" label for admins instead (mirroring NamespaceMemberRow).

import React from 'react';
import { CAPABILITIES } from '@/constants/config';
import type { Role } from '@/generated/registry/RegistryClient';

const C = CAPABILITIES;

export const MANAGER_FOLDER_CAPS =
  C.CAN_INVITE_MEMBERS |
  C.MANAGE_MEMBERS |
  C.CAN_MANAGE_VISIBILITY |
  C.CAN_DELETE_SUBGROUP |
  C.CAN_MANAGE_METADATA;

export interface FolderRolePreset {
  label: string;
  role: Role;
  folderCaps: number;
}

export const FOLDER_ROLE_PRESETS: FolderRolePreset[] = [
  { label: 'Viewer', role: 'Viewer', folderCaps: 0 },
  { label: 'Editor', role: 'Editor', folderCaps: 0 },
  { label: 'Manager', role: 'Manager', folderCaps: MANAGER_FOLDER_CAPS },
];

interface Props {
  role: Role | null;
  folderCaps: number | null;
  onChange: (preset: FolderRolePreset) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function FolderRoleSelect({
  role,
  folderCaps,
  onChange,
  disabled,
  ariaLabel,
}: Props) {
  const loading = role === null || folderCaps === null;
  const matched = loading
    ? null
    : FOLDER_ROLE_PRESETS.find(
        (p) => p.role === role && p.folderCaps === folderCaps,
      );
  const current = matched?.label ?? (loading ? '' : 'Custom');

  return (
    <select
      aria-label={ariaLabel ?? 'Folder role'}
      value={current}
      disabled={disabled || loading}
      onChange={(e) => {
        const preset = FOLDER_ROLE_PRESETS.find(
          (p) => p.label === e.target.value,
        );
        if (preset) onChange(preset);
        // "Custom" is a no-op — see file header.
      }}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading && <option value="">Loading…</option>}
      {FOLDER_ROLE_PRESETS.map((p) => (
        <option key={p.label} value={p.label}>
          {p.label}
        </option>
      ))}
      {current === 'Custom' && <option value="Custom">Custom</option>}
    </select>
  );
}
