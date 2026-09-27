// Registry-level ownership + managers — the fail-closed authorization
// gate for the per-folder `Role` API (set_folder_role, add_manager,
// etc. all require owner-or-manager). See design spec §5.4.
//
// A thin read of `useDriveWorkspace().registryAdmin`: the fetch (`getOwner` +
// `listManagers`) runs once per workspace there, not once per folder row.
//
// `owner` is `null` when unclaimed; `isOwnerOrManager` gates writing
// folder roles / the sharing-panel admin section; `isOwner` is the
// stricter "can edit the manager list" signal (mirrors the WASM —
// managers can mutate folder roles but not the manager list itself).

import { useDriveWorkspace } from './useDriveWorkspace';
import type { RegistryAdminSlice } from './useDriveWorkspace';

export type RegistryAdminState = RegistryAdminSlice;

export function useRegistryAdmin(): RegistryAdminState {
  return useDriveWorkspace().registryAdmin;
}
