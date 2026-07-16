/**
 * useAliases - resolves context-identity public keys to their human-readable
 * alias (`mero.admin.listContextIdentityAliases`), falling back to a
 * truncated key when no alias is set. Aliases are a display enhancement
 * only: a failed fetch just leaves the cache empty (raw keys still render
 * fine via the fallback), never blocking the app.
 *
 * The alias list is loaded once per context and cached in module state, so
 * every call site (members list, issue detail, sidebar) shares one fetch.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { truncateKey } from '../utils/display';

export interface UseAliasesReturn {
  /** identity public key -> its alias, or a truncated key when none is set. */
  resolve: (publicKey: string) => string;
  /** True when `publicKey` has a real alias (vs. the truncated-key fallback). */
  hasAlias: (publicKey: string) => boolean;
  /** Re-fetch the alias list (call after creating/changing an alias). */
  refresh: () => Promise<void>;
  /** Registers `alias` for `identity` and refreshes the cache. Throws on failure - this
   *  is a direct user action (the Set-my-alias modal), unlike the read paths, which
   *  tolerate failure silently. */
  setAlias: (alias: string, identity: string) => Promise<void>;
  loading: boolean;
  /** True once a fetch for this context has settled at least once. */
  loaded: boolean;
}

/** publicKey -> alias name, given the raw {name, value} entries the admin API returns. */
export function buildAliasMap(entries: { name: string; value: string }[]): Map<string, string> {
  return new Map(entries.map((e) => [e.value, e.name]));
}

/** The actual `resolve()` logic: alias if known, else a truncated key. Exported so
 *  tests exercise this directly instead of a parallel re-implementation. */
export function resolveFromMap(map: Map<string, string>, publicKey: string): string {
  return map.get(publicKey) ?? truncateKey(publicKey);
}

const cache = new Map<string, Map<string, string>>();

export function useAliases(contextId: string | null): UseAliasesReturn {
  const { mero } = useMero();
  const [map, setMap] = useState<Map<string, string>>(
    () => (contextId && cache.get(contextId)) || new Map(),
  );
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(() => !!(contextId && cache.has(contextId)));

  const load = useCallback(async () => {
    if (!mero || !contextId) return;
    setLoading(true);
    try {
      // The node returns identity aliases as a flat { aliasName: identityKey }
      // map, though mero-js types it as { aliases: [{ name, value }] }. Accept
      // both so a future contract alignment keeps working.
      const res = await mero.admin.listContextIdentityAliases(contextId) as
        | { aliases?: { name: string; value: string }[] }
        | Record<string, string>;
      const entries = Array.isArray((res as { aliases?: unknown }).aliases)
        ? (res as { aliases: { name: string; value: string }[] }).aliases
        : Object.entries(res as Record<string, string>).map(([name, value]) => ({ name, value: String(value) }));
      const next = buildAliasMap(entries);
      cache.set(contextId, next);
      setMap(next);
    } catch {
      /* enhancement only - keep whatever the cache last held (or empty) */
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [mero, contextId]);

  useEffect(() => {
    if (!contextId) { setMap(new Map()); setLoaded(false); return; }
    const cached = cache.get(contextId);
    if (cached) { setMap(cached); setLoaded(true); return; }
    // Reset synchronously so a context switch never briefly serves the
    // previous context's aliases while the new fetch is in flight.
    setMap(new Map());
    setLoaded(false);
    void load();
  }, [contextId, load]);

  const resolve = useCallback(
    (publicKey: string) => resolveFromMap(map, publicKey),
    [map],
  );
  const hasAlias = useCallback((publicKey: string) => map.has(publicKey), [map]);

  const setAlias = useCallback(
    async (alias: string, identity: string) => {
      if (!mero || !contextId) throw new Error('Workspace not ready');
      await mero.admin.createContextIdentityAlias(contextId, { alias, identity });
      await load();
    },
    [mero, contextId, load],
  );

  return { resolve, hasAlias, refresh: load, setAlias, loading, loaded };
}
