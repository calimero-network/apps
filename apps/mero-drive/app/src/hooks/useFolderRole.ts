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
//
// Flicker-prevention: a re-fetch (tick bump or a registryClient re-
// memo — useDriveWorkspace rebuilds the client on selfIdentity /
// registryContextId churn) MUST NOT collapse `role` back to `null` in
// the meantime; that briefly flips `canEditDocs` to false in the doc
// editor and bounces the read-only banner. We only clear `role` when
// the *folder id* actually changes — a genuinely different folder
// legitimately warrants `null` while loading. For same-folder re-
// fetches, the previous resolved value stays visible until the new
// one lands.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useContextEvents } from './useContextEvents';
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
  const { registryClient, registryContextId, selfIdentity } =
    useDriveWorkspace();
  const [role, setRoleState] = useState<Role | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetching, setFetching] = useState(false);
  const [tick, setTick] = useState(0);
  // Registry role changes go through the registry context, not the
  // group context — so subscribe there and force a refetch on any
  // registry event. Coarse (re-runs for unrelated registry ops) but
  // cheap (single getFolderRole call).
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  useContextEvents(registryContextId, refetch);

  // Last folder id we kicked a fetch off for. When `folderId` changes
  // (genuinely different folder), we DO want to clear the previous
  // role to null while loading — a stale Editor/Viewer from a sibling
  // folder would be a lie. For same-folder re-fetches (registryClient
  // re-memo, tick bump), we keep the prior value visible until the new
  // one resolves. Without this guard, every churn of useDriveWorkspace
  // bounces canEditDocs through false → true on the next render.
  const lastFolderIdRef = useRef<string | null>(null);

  // `folderId` may be empty-string from `useFolderPermissions` when no
  // folder is selected — treat that as "no folder", not "loading".
  const canFetch = !!registryClient && !!folderId && !!selfIdentity;

  useEffect(() => {
    // Local non-null bindings — `canFetch` already implies these are
    // non-null, but the redundant guard keeps TypeScript honest without
    // non-null assertions (`!`) inside the effect body.
    const client = registryClient;
    const folder = folderId;
    const member = selfIdentity;
    if (!client || !folder || !member) {
      // No registry / no folder selected → nothing to fetch. Wipe the
      // role so we don't show a stale value from a previous folder.
      lastFolderIdRef.current = null;
      setRoleState(null);
      setError(null);
      setFetching(false);
      return;
    }
    const folderChanged = lastFolderIdRef.current !== folder;
    if (folderChanged) {
      // Different folder → clear prior role; loading from null is the
      // honest state until the new role resolves.
      setRoleState(null);
    }
    // Always clear the error before a fresh attempt — keeps a previous
    // failure from haunting a subsequent successful refetch.
    setError(null);
    setFetching(true);
    lastFolderIdRef.current = folder;
    let cancelled = false;
    client
      .getFolderRole({ folder_id: folder, member })
      .then((r) => {
        if (cancelled) return;
        setRoleState((r as Role) ?? 'Editor');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (cancelled) return;
        setFetching(false);
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
    // Loading == "a fetch is in flight". When there's no Registry
    // context (`!canFetch`), `loading` is false (`registryAvailable`
    // is false too) so the doc editor falls back to folder membership
    // rather than being pinned read-only forever.
    loading: canFetch && fetching,
    error,
    registryAvailable: !!registryClient,
    setRole,
    clearRole,
    refetch,
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
  const { registryClient, registryContextId } = useDriveWorkspace();
  const [entries, setEntries] = useState<FolderRoleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  // Registry role changes propagate via the registry context. Bump
  // the tick on any registry event so the next read picks up the
  // updated FolderRoleEntry rows.
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  useContextEvents(registryContextId, refetch);

  // Same flicker-prevention as useFolderRole: keep the previous
  // entries visible across registryClient re-memos / tick refetches;
  // only clear when the folderId genuinely changes.
  const lastFolderIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!registryClient || !folderId) {
      lastFolderIdRef.current = null;
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    const folderChanged = lastFolderIdRef.current !== folderId;
    if (folderChanged) setEntries([]);
    lastFolderIdRef.current = folderId;
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

  return { entries, loading, error, refetch };
}
