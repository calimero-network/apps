/**
 * People-name resolution. Names now live in namespace member metadata
 * (setMemberMetadata), resolved to a display name and falling back to a
 * truncated key when a member has none. `useWorkspace` owns the member map;
 * `makeAliases` adapts it into the small `UseAliasesReturn` surface the
 * members list, deal pages, and sidebar already consume.
 */
import { canonicalAccount } from '@calimero-apps/names';
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

/** The map key for an identity: canonical hex for an account (the admin API
 *  speaks hex, contracts stamp base58), the raw string for anything else. */
function aliasKey(publicKey: string): string {
  return canonicalAccount(publicKey) ?? publicKey;
}

/** publicKey -> name, given the raw {name, value} entries. Keyed canonically,
 *  so a hex and a base58 spelling of one account find the same name. */
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
 * New deals store the owner's ACCOUNT, so a rename (or a name set after the
 * deal was assigned) shows everywhere. Older deals stored the label itself:
 * a name is shown as-is, and a frozen truncated key (`4f8a…c2e1`, stored when
 * that member had no name yet) is matched back to its member and resolved.
 */
export function ownerLabel(
  owner: string | null | undefined,
  resolve: (publicKey: string) => string,
  members: readonly string[],
): string {
  if (!owner) return '';
  if (canonicalAccount(owner)) return resolve(owner);
  const member = owner.includes('…') ? members.find((m) => truncateKey(m) === owner) : undefined;
  return member ? resolve(member) : owner;
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
