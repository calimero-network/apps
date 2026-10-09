import type { LensHost } from "./lens/lens";
import { identitiesOf } from "./collector";

/**
 * What a lens runs against on a node: the app's own methods in the event's
 * context, who you are, and people's names.
 *
 * Names are not an app's business: every app on a node lives in a namespace,
 * and a person's name is their member metadata there (what Chat shows too).
 * The node lists members by account, in hex; apps write an account in base58,
 * so both forms are indexed.
 */

/** The slice of mero-js's admin API this needs. */
export interface NodeAdmin {
  getNodeIdentity(): Promise<{ accountId?: string | null; deviceId?: string | null }>;
  getContextGroup(contextId: string): Promise<string | null>;
  listGroupMembers(groupId: string): Promise<unknown>;
  listNamespaces(): Promise<{ namespaceId: string }[]>;
}

export interface NodeRpc {
  execute<T>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T>;
}

/** A name read again after this long, so a rename shows up. */
const NAMES_FRESH_MS = 60_000;

export function nodeLensHosts(rpc: NodeRpc, admin: NodeAdmin, now: () => number = Date.now) {
  let self: Promise<Set<string>> | null = null;
  const names = new Map<string, string>();
  let loadedAt = 0;
  let loading: Promise<void> | null = null;
  const groupsRead = new Set<string>();

  const me = () => {
    if (!self) {
      const asked = admin.getNodeIdentity().then((id) => identitiesOf([id.accountId, id.deviceId]));
      // A failed lookup is asked again next time, not remembered.
      asked.catch(() => {
        self = null;
      });
      self = asked;
    }
    return self;
  };

  const readGroup = async (groupId: string) => {
    const raw = await admin.listGroupMembers(groupId);
    const members = (Array.isArray(raw) ? raw : ((raw as { members?: unknown[] })?.members ?? [])) as {
      identity: string;
      name?: string;
      alias?: string;
    }[];
    for (const m of members) {
      const name = (m.name ?? m.alias ?? "").trim();
      if (!name) continue;
      for (const form of identitiesOf([m.identity])) names.set(form, name);
    }
  };

  /** Every namespace's members, plus the context's own group. Once a minute at most. */
  const load = async (contextId: string) => {
    if (now() - loadedAt < NAMES_FRESH_MS && groupsRead.has(contextId)) return;
    loading ??= (async () => {
      try {
        const group = await admin.getContextGroup(contextId).catch(() => null);
        const namespaces = await admin.listNamespaces().catch(() => []);
        const groups = [...new Set([group, ...namespaces.map((n) => n.namespaceId)].filter(Boolean) as string[])];
        await Promise.all(groups.map((g) => readGroup(g).catch(() => undefined)));
        groupsRead.add(contextId);
        loadedAt = now();
      } finally {
        loading = null;
      }
    })();
    await loading;
  };

  return (contextId: string): LensHost => ({
    call: <T>(method: string, args: Record<string, unknown>) => rpc.execute<T>({ contextId, method, argsJson: args }),
    me,
    name: async (identity: string) => {
      if (!names.has(identity)) await load(contextId);
      return names.get(identity) ?? "";
    },
  });
}
