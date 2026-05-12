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
  /** The caller's role on this folder. `null` = not-yet-resolved
   *  (either still fetching, or there's no Registry context to fetch
   *  from). Disambiguate with `loading` + `registryAvailable`. An
   *  absent-on-server role resolves to `'Editor'` (the WASM default). */
  role: Role | null;
  /** True ONLY while a fetch is in flight. False when there's no
   *  Registry context (nothing to fetch) — so consumers don't get
   *  pinned in a "checking permissions" state forever in a workspace
   *  that has no Registry context yet. */
  loading: boolean;
  error: Error | null;
  /** Whether a Registry context exists to read roles from. When false,
   *  `role` is `null` and never resolves — callers should fall back to
   *  folder membership for edit rights. */
  registryAvailable: boolean;
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

  // `folderId` may be empty-string from `useFolderPermissions` when no
  // folder is selected — treat that as "no folder", not "loading".
  const canFetch = !!registryClient && !!folderId && !!selfIdentity;

  useEffect(() => {
    if (!canFetch) {
      setRoleState(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setRoleState(null);
    setError(null);
    registryClient!
      .getFolderRole({ folder_id: folderId!, member: selfIdentity! })
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
    // canFetch derives from registryClient/folderId/selfIdentity; tick
    // forces a refetch after a write.
  }, [canFetch, registryClient, folderId, selfIdentity, tick]);

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
    // Loading == "a fetch can happen and hasn't resolved yet". When
    // there's no Registry context (`!canFetch`), `loading` is false
    // (`registryAvailable` is false too) so the doc editor falls back
    // to folder membership rather than being pinned read-only forever.
    loading: canFetch && role === null && error === null,
    error,
    registryAvailable: !!registryClient,
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
