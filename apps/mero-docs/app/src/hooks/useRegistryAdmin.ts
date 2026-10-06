// Registry-level ownership + managers (add_manager / remove_manager are
// owner-only in the contract). Folder roles are core's, not the registry's.
//
// A thin read of `useDriveWorkspace().registryAdmin`: the fetch (`getOwner` +
// `listManagers`) runs once per workspace there, not once per folder row.
//
// `owner` is `null` when unclaimed; `isOwnerOrManager` feeds the
// sharing panel's "ask the owner" hint (`useFolderPermissions`); `isOwner`
// is the stricter "can edit the manager list" signal (mirrors the WASM,
// where only the owner may add or remove managers).

import { useDriveWorkspace } from './useDriveWorkspace';
import type { RegistryAdminSlice } from './useDriveWorkspace';

export type RegistryAdminState = RegistryAdminSlice;

export function useRegistryAdmin(): RegistryAdminState {
  return useDriveWorkspace().registryAdmin;
}
