import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { shortAccount, toAccountHex } from "../../utils/accountIdentity";
import { LayeredRepository } from "../core/LayeredRepository";
import { IndexedDbPersistence } from "../core/IndexedDbPersistence";
import type { SourceLayer } from "../core/types";
import { NAME_POLICY } from "./policy";

/**
 * The one place that answers "what is this account called".
 *
 * # The rule
 *
 * A display name is **resolved from an account, never carried alongside one and
 * never compared**. Everything that used to hold its own copy — the username
 * stamped into each message, the `{c,o}` pair frozen into a DM description, the
 * per-context WASM `profiles` map, a `localStorage` global — was a snapshot, and
 * snapshots cannot be renamed. The same person appeared under different names in
 * different views, and worse, names were compared to decide whether a message
 * was yours or whether a DM already existed. Two members choosing the same name
 * broke both.
 *
 * Names are for reading. `sameAccount` is for comparing. There is no case where
 * the second should be spelled with the first.
 *
 * # Source of truth
 *
 * Namespace member metadata: keyed by account, owned by that account, changeable
 * by them, replicated through governance. Read via `listMembers(namespaceId)`.
 */
class MemberMetadataSource implements SourceLayer<string> {
  private api = new GroupApiDataSource();

  async load(keys: string[]): Promise<Map<string, string | undefined>> {
    const out = new Map<string, string | undefined>();
    // Keys are `namespace|account`: a name belongs to an account IN a
    // namespace. One account (Calimero 1.0) is the same in every workspace,
    // and may go by a different name in each.
    const byNamespace = new Map<string, string[]>();
    for (const key of keys) {
      const parsed = splitKey(key);
      if (!parsed) continue;
      const list = byNamespace.get(parsed.namespaceId) ?? [];
      list.push(key);
      byNamespace.set(parsed.namespaceId, list);
    }

    await Promise.all(
      [...byNamespace].map(async ([namespaceId, wanted]) => {
        const resp = await this.api.listMembers(namespaceId);
        const members = resp?.data?.members;
        if (!members) return;
        // Index the whole member list, not just the requested keys: one call
        // already carries every name, and caching them all means the next 200
        // rows are answered from memory.
        members.forEach((m: { identity: string; alias?: string }) => {
          const alias = m.alias?.trim();
          if (!alias) return;
          const account = canonical(m.identity);
          if (account) out.set(scopedKey(namespaceId, account), alias);
        });
        // Requested keys absent from the list genuinely have no name: assert
        // that so negative caching can hold, rather than leaving them to re-fetch.
        for (const key of wanted) if (!out.has(key)) out.set(key, undefined);
      }),
    );

    return out;
  }
}

const SEP = "|";

function scopedKey(namespaceId: string, account: string): string {
  return `${namespaceId}${SEP}${account}`;
}

function splitKey(key: string): { namespaceId: string; account: string } | undefined {
  const at = key.indexOf(SEP);
  if (at <= 0) return undefined;
  return { namespaceId: key.slice(0, at), account: key.slice(at + 1) };
}

/**
 * Canonical account key.
 *
 * `listMembers` reports base58 or hex depending on which path wrote the member,
 * and a message's sender arrives in whichever form the contract emitted.
 * Comparing raw strings silently misses — which is precisely the bug the old
 * name-equality checks were unknowingly compensating for.
 */
function canonical(account: string | undefined): string | undefined {
  const id = account?.trim();
  if (!id) return undefined;
  try {
    return toAccountHex(id);
  } catch {
    return undefined;
  }
}

export class NameRepository {
  private repo: LayeredRepository<string>;

  constructor(private readonly getNamespaceId: () => string | undefined) {
    this.repo = new LayeredRepository<string>(
      new MemberMetadataSource(),
      NAME_POLICY,
      new IndexedDbPersistence<string>("names"),
    );
  }

  /** `account`'s key in the current namespace, or undefined before there is one. */
  private key(account: string | undefined): string | undefined {
    const namespaceId = this.getNamespaceId();
    const hex = canonical(account);
    return namespaceId && hex ? scopedKey(namespaceId, hex) : undefined;
  }

  /**
   * The name to render for `account`, always a usable string.
   *
   * Falls back to a truncated account, which is true, rather than to a name
   * captured earlier, which may no longer be. Safe to call during render: it
   * schedules a fetch but never suspends.
   */
  displayName(account: string | undefined): string {
    const key = this.key(account);
    if (!key) return shortAccount(account);
    return this.repo.get(key) || shortAccount(account);
  }

  /** Known name, without scheduling a fetch. For hot paths and tests. */
  peek(account: string | undefined): string | undefined {
    const key = this.key(account);
    return key ? this.repo.peek(key) : undefined;
  }

  /** Await the authoritative name — for non-render callers such as notifications. */
  async resolve(account: string | undefined): Promise<string> {
    const key = this.key(account);
    if (!key) return shortAccount(account);
    return (await this.repo.resolve(key)) || shortAccount(account);
  }

  /**
   * Forget a name (or all of them) so the next read re-fetches.
   *
   * Call after a rename: the new name should appear immediately rather than
   * when the TTL happens to lapse.
   */
  invalidate(account?: string): void {
    this.repo.invalidate(account ? this.key(account) : undefined);
  }

  subscribe(fn: () => void): () => void {
    return this.repo.subscribe(fn);
  }
}
