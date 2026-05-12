// Per-(folder, member) registry `Role` — the "Viewer vs Editor vs
// Manager on documents" concept that lives in the Registry WASM, NOT
// in core's capability bitmask (see design spec §5.3 / §5.5).
//
// A member with NO explicit role row is treated as `Editor` — that's
// the WASM's own default (`clear_folder_role` resets to Editor; an
// absent key reads back as Editor). So `role === null` here means
// "still loading / unknown", never "no access".
//
// Reads go through `registryClient.getFolderRole({ folder_id, member })`
// / `listFolderRoles({ folder_id })`. Writes go through
// `setFolderRole` / `clearFolderRole`. A `tick` counter forces a
// refetch after a write (and via `refetch()` for external callers).

import { useCallback, useEffect, useState } from 'react';
import { useDriveWorkspace } from './useDriveWorkspace';
import type { Role, FolderRoleEntry } from '../api/registry/RegistryClient';

export interface FolderRoleState {
  /** The caller's role on this folder. `null` = loading / unknown.
   *  An absent-on-server role resolves to `'Editor'` (the WASM default). */
  role: Role | null;
  loading: boolean;
  error: Error | null;
  /** Set a member's role (defaults to the current identity). Refetches
   *  on success. */
  setRole: (role: Role, member?: string) => Promise<void>;
  /** Clear a member's explicit role (back to the WASM default `Editor`).
   *  Defaults to the current identity. Refetches on success. */
  clearRole: (member?: string) => Promise<void>;
  refetch: () => void;
}

export function useFolderRole(folderId: string | null): FolderRoleState {
  const { registryClient, selfIdentity } = useDriveWorkspace();
  const [role, setRoleState] = useState<Role | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!registryClient || !folderId || !selfIdentity) {
      setRoleState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setRoleState(null);
    setError(null);
    registryClient
      .getFolderRole({ folder_id: folderId, member: selfIdentity })
      .then((r) => {
        if (!cancelled) setRoleState((r as Role) ?? 'Editor');
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [registryClient, folderId, selfIdentity, tick]);

  const setRole = useCallback(
    async (r: Role, member?: string) => {
      if (!registryClient || !folderId) return;
      const m = member ?? selfIdentity;
      if (!m) return;
      await registryClient.setFolderRole({
        folder_id: folderId,
        member: m,
        role: r,
      });
      setTick((t) => t + 1);
    },
    [registryClient, folderId, selfIdentity],
  );

  const clearRole = useCallback(
    async (member?: string) => {
      if (!registryClient || !folderId) return;
      const m = member ?? selfIdentity;
      if (!m) return;
      await registryClient.clearFolderRole({ folder_id: folderId, member: m });
      setTick((t) => t + 1);
    },
    [registryClient, folderId, selfIdentity],
  );

  return {
    role,
    loading: role === null && error === null,
    error,
    setRole,
    clearRole,
    refetch: () => setTick((t) => t + 1),
  };
}

export interface FolderRolesState {
  /** Explicit role rows for this folder. Members not present here use
   *  the WASM default (`Editor`). */
  entries: FolderRoleEntry[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useFolderRoles(folderId: string | null): FolderRolesState {
  const { registryClient } = useDriveWorkspace();
  const [entries, setEntries] = useState<FolderRoleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!registryClient || !folderId) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    registryClient
      .listFolderRoles({ folder_id: folderId })
      .then((rows) => {
        if (!cancelled) setEntries(rows ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [registryClient, folderId, tick]);

  return { entries, loading, error, refetch: () => setTick((t) => t + 1) };
}
