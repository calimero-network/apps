/**
 * People-name resolution. Names now live in namespace member metadata
 * (setMemberMetadata), resolved to a display name and falling back to a
 * truncated key when a member has none. `useWorkspace` owns the member map;
 * `makeAliases` adapts it into the small `UseAliasesReturn` surface the
 * members list, issue detail, and sidebar already consume.
 */
import { truncateKey } from '../utils/display';

export interface UseAliasesReturn {
  /** identity public key -> its display name, or a truncated key when none is set. */
  resolve: (publicKey: string) => string;
  /** True when `publicKey` has a real display name (vs. the truncated-key fallback). */
  hasAlias: (publicKey: string) => boolean;
  /** Re-fetch the member list (call after changing a name). */
  refresh: () => Promise<void>;
  /** Sets the current member's display name and refreshes the cache. Throws on
   *  failure - this is a direct user action (the Set-my-alias modal). */
  setAlias: (alias: string, identity: string) => Promise<void>;
  loading: boolean;
  /** True once the member list for this namespace has settled at least once. */
  loaded: boolean;
}

/** publicKey -> name, given the raw {name, value} entries. */
export function buildAliasMap(entries: { name: string; value: string }[]): Map<string, string> {
  return new Map(entries.map((e) => [e.value, e.name]));
}

/** The actual `resolve()` logic: name if known, else a truncated key. Exported so
 *  tests exercise this directly instead of a parallel re-implementation. */
export function resolveFromMap(map: Map<string, string>, publicKey: string): string {
  return map.get(publicKey) ?? truncateKey(publicKey);
}

/** Adapt the namespace member-name map into the `UseAliasesReturn` surface. */
export function makeAliases(
  memberNames: Map<string, string>,
  setMemberName: (name: string) => Promise<void>,
  refresh: () => Promise<void>,
  loading: boolean,
  loaded: boolean,
): UseAliasesReturn {
  return {
    resolve: (publicKey: string) => resolveFromMap(memberNames, publicKey),
    hasAlias: (publicKey: string) => memberNames.has(publicKey),
    refresh,
    setAlias: (alias: string) => setMemberName(alias),
    loading,
    loaded,
  };
}
