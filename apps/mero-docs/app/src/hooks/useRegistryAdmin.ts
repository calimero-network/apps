// Registry-level ownership + managers — the fail-closed authorization
// gate for the per-folder `Role` API (set_folder_role, add_manager,
// etc. all require owner-or-manager). See design spec §5.4.
//
// As of the code-review pass that hoisted this state, the actual fetch
// (`getOwner` + `listManagers`) lives in `useDriveWorkspace` and runs
// ONCE per workspace — this hook is now just a thin read of that slice
// (`useDriveWorkspace().registryAdmin`). Previously each
// `FolderContextMenu` row called this hook directly, firing N identical
// getOwner/listManagers pairs for an N-folder tree.
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
