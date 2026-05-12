// Registry-level ownership + managers — the fail-closed authorization
// gate for the per-folder `Role` API (set_folder_role, add_manager,
// etc. all require owner-or-manager). See design spec §5.4.
//
// `owner` is read from `registryClient.getOwner()` which returns a
// `string` ("" === unclaimed); we normalise "" → null. `managers` is
// `listManagers()`. Only the owner can add/remove managers (mirrors
// the WASM); a manager can mutate folder roles but not the manager
// list itself.
//
// A `tick` counter forces a refetch after a mutation (and via
// `refetch()` for external callers).

import { useCallback, useEffect, useState } from 'react';
import { useDriveWorkspace } from './useDriveWorkspace';

export interface RegistryAdminState {
  /** Registry owner identity, or `null` when unclaimed (legacy
   *  namespace seeded before `claim_owner` was wired in). */
  owner: string | null;
  managers: string[];
  /** True when the current identity is the owner OR a manager — the
   *  signal that gates writing folder roles / the sharing-panel admin
   *  section (`canManagePermissions`). */
  isOwnerOrManager: boolean;
  /** True only when the current identity is the owner — managers can't
   *  add/remove other managers, mirroring the WASM. */
  isOwner: boolean;
  loading: boolean;
  error: Error | null;
  /** Owner-only on the server; the UI should also gate on `isOwner`. */
  addManager: (member: string) => Promise<void>;
  removeManager: (member: string) => Promise<void>;
  /** Claim the owner slot for the current identity (no-op if already
   *  owned by this identity; errors if a different key owns it). */
  claimOwner: () => Promise<void>;
  refetch: () => void;
}

export function useRegistryAdmin(): RegistryAdminState {
  const { registryClient, selfIdentity } = useDriveWorkspace();
  const [owner, setOwner] = useState<string | null>(null);
  const [managers, setManagers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!registryClient) {
      setOwner(null);
      setManagers([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([registryClient.getOwner(), registryClient.listManagers()])
      .then(([o, m]) => {
        if (cancelled) return;
        setOwner(o && o.length > 0 ? o : null);
        setManagers(m ?? []);
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
  }, [registryClient, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const addManager = useCallback(
    async (member: string) => {
      if (!registryClient || !member) return;
      await registryClient.addManager({ member });
      setTick((t) => t + 1);
    },
    [registryClient],
  );

  const removeManager = useCallback(
    async (member: string) => {
      if (!registryClient || !member) return;
      await registryClient.removeManager({ member });
      setTick((t) => t + 1);
    },
    [registryClient],
  );

  const claimOwner = useCallback(async () => {
    if (!registryClient) return;
    await registryClient.claimOwner();
    setTick((t) => t + 1);
  }, [registryClient]);

  const isOwner = !!owner && owner === selfIdentity;
  const isOwnerOrManager =
    isOwner || (!!selfIdentity && managers.includes(selfIdentity));

  return {
    owner,
    managers,
    isOwnerOrManager,
    isOwner,
    loading,
    error,
    addManager,
    removeManager,
    claimOwner,
    refetch,
  };
}
