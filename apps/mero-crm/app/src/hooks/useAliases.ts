/**
 * People-name resolution. Names now live in namespace member metadata
 * (setMemberMetadata), resolved to a display name and falling back to a
 * truncated key when a member has none. `useWorkspace` owns the member map;
 * `makeAliases` adapts it into the small `UseAliasesReturn` surface the
 * members list, deal pages, and sidebar already consume.
 */
import { truncateKey } from '../utils/display';

export interface UseAliasesReturn {
  /** identity public key -> its display name, or a truncated key when none is set. */
  resolve: (publicKey: string) => string;
  /** True when `publicKey` has a real display name (vs. the truncated-key fallback). */
  hasAlias: (publicKey: string) => boolean;
  /** Label for a stored deal/activity `owner`: see {@link ownerLabel}. */
  ownerName: (owner: string | null | undefined) => string;
  /** Re-fetch the member list (call after changing a name). */
  refresh: () => Promise<void>;
  /** Sets the current member's display name and refreshes the cache. Throws on
   *  failure - this is a direct user action (the Set-my-alias modal). */
  setAlias: (alias: string, identity: string) => Promise<void>;
  loading: boolean;
  /** True once the member list for this namespace has settled at least once. */
  loaded: boolean;
}

/** The map key for an identity: the account id, spelled the same by the org's
 *  member list and by the contract's `createdBy`/`author`. */
function aliasKey(publicKey: string): string {
  return publicKey;
}

/** publicKey -> name, given the raw {name, value} entries. */
export function buildAliasMap(entries: { name: string; value: string }[]): Map<string, string> {
  return new Map(entries.map((e) => [aliasKey(e.value), e.name]));
}

/** The actual `resolve()` logic: name if known, else a truncated key. Exported so
 *  tests exercise this directly instead of a parallel re-implementation. */
export function resolveFromMap(map: Map<string, string>, publicKey: string): string {
  return map.get(aliasKey(publicKey)) ?? truncateKey(publicKey);
}

/**
 * The label for a stored `owner`, resolved at display time.
 *
 * A deal stores the owner's ACCOUNT id, so a rename (or a name set after the
 * deal was assigned) shows everywhere. A free-text owner (an integration, or a
 * former member) is shown as-is, and a truncated key (`4f8a…c2e1`) is matched
 * back to its member and resolved.
 */
export function ownerLabel(
  owner: string | null | undefined,
  resolve: (publicKey: string) => string,
  members: readonly string[],
): string {
  if (!owner) return '';
  if (members.includes(owner) || memberNamed(resolve, owner)) return resolve(owner);
  const member = owner.includes('…') ? members.find((m) => truncateKey(m) === owner) : undefined;
  return member ? resolve(member) : owner;
}

/** True when `owner` is an account the name map knows. */
function memberNamed(resolve: (publicKey: string) => string, owner: string): boolean {
  return resolve(owner) !== truncateKey(owner);
}

/** Adapt the namespace member-name map into the `UseAliasesReturn` surface. */
export function makeAliases(
  memberNames: Map<string, string>,
  setMemberName: (name: string) => Promise<void>,
  refresh: () => Promise<void>,
  loading: boolean,
  loaded: boolean,
  members: readonly string[] = [],
): UseAliasesReturn {
  const resolve = (publicKey: string) => resolveFromMap(memberNames, publicKey);
  return {
    resolve,
    hasAlias: (publicKey: string) => memberNames.has(aliasKey(publicKey)),
    ownerName: (owner) => ownerLabel(owner, resolve, members),
    refresh,
    setAlias: (alias: string) => setMemberName(alias),
    loading,
    loaded,
  };
}
