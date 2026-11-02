import { maybeConnection } from "../../calimero/connection";
import { listMembers } from "../../calimero/workspace";
import { shortAccount, toAccountHex } from "../../utils/accountIdentity";
import { LayeredRepository } from "../core/LayeredRepository";
import { IndexedDbPersistence } from "../core/IndexedDbPersistence";
import type { SourceLayer } from "../core/types";
import { NAME_POLICY } from "./policy";

/**
 * Names come from the workspace (the org): each member's metadata `{ name }`,
 * which they set when they create or join it. One read of the org answers
 * every key, as v1's namespace member list did.
 */
class MemberMetadataSource implements SourceLayer<string> {
  constructor(private readonly getOrg: () => string | undefined) {}

  async load(keys: string[]): Promise<Map<string, string | undefined>> {
    const org = this.getOrg();
    const conn = maybeConnection();
    const out = new Map<string, string | undefined>();
    if (!org || !conn) return out;
    try {
      for (const m of await listMembers(conn.client, org)) {
        if (m.name.trim()) out.set(m.account, m.name.trim());
      }
    } finally {
      conn.after();
    }
    for (const key of keys) if (!out.has(key)) out.set(key, undefined);
    return out;
  }
}

function canonical(account: string | undefined): string | undefined {
  const id = toAccountHex(account);
  return id || undefined;
}

export class NameRepository {
  private repo: LayeredRepository<string>;

  constructor(getOrg: () => string | undefined) {
    this.repo = new LayeredRepository<string>(
      new MemberMetadataSource(getOrg),
      NAME_POLICY,
      new IndexedDbPersistence<string>("names"),
    );
  }

  displayName(account: string | undefined): string {
    const key = canonical(account);
    if (!key) return shortAccount(account);
    return this.repo.get(key) || shortAccount(account);
  }

  peek(account: string | undefined): string | undefined {
    const key = canonical(account);
    return key ? this.repo.peek(key) : undefined;
  }

  async resolve(account: string | undefined): Promise<string> {
    const key = canonical(account);
    if (!key) return shortAccount(account);
    return (await this.repo.resolve(key)) || shortAccount(account);
  }

  invalidate(account?: string): void {
    this.repo.invalidate(account ? canonical(account) : undefined);
  }

  subscribe(fn: () => void): () => void {
    return this.repo.subscribe(fn);
  }
}
