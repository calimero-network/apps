import { memberNames } from "@calimero-apps/names";
import type { LensHost } from "./lens/lens";
import { identitiesOf } from "./collector";

/**
 * What a lens runs against on a node: the app's own methods in the event's
 * context, who you are, and people's names.
 *
 * Names are not an app's business: every app on a node lives in a namespace,
 * and a person's name is their member metadata there (what Chat shows too).
 * The node lists members by account, in hex; apps write an account in base58.
 * Both are read through `@calimero-apps/names`, which matches either form and
 * shares one cached listing per namespace with every other view on the page.
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

/** Which groups a context's names come from, asked again after this long. */
const GROUPS_FRESH_MS = 60_000;

export function nodeLensHosts(rpc: NodeRpc, admin: NodeAdmin, now: () => number = Date.now) {
  let self: Promise<Set<string>> | null = null;
  const groupsOf = new Map<string, { groups: Promise<string[]>; at: number }>();

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

  /**
   * Every namespace, then the context's own group: a person's name is their
   * namespace member metadata first. Each listing answers from the shared
   * cache until it goes stale, so a rename shows up on a later read instead of
   * the first name ever seen being kept.
   */
  const groupsFor = (contextId: string): Promise<string[]> => {
    const hit = groupsOf.get(contextId);
    if (hit && now() - hit.at < GROUPS_FRESH_MS) return hit.groups;
    const groups = (async () => {
      const group = await admin.getContextGroup(contextId).catch(() => null);
      const namespaces = await admin.listNamespaces().catch(() => []);
      return [...new Set([...namespaces.map((n) => n.namespaceId), group].filter(Boolean) as string[])];
    })();
    groupsOf.set(contextId, { groups, at: now() });
    return groups;
  };

  return (contextId: string): LensHost => ({
    call: <T>(method: string, args: Record<string, unknown>) => rpc.execute<T>({ contextId, method, argsJson: args }),
    me,
    name: async (identity: string) => {
      const groups = await groupsFor(contextId);
      await Promise.all(groups.map((g) => memberNames.load(admin, g)));
      for (const g of groups) {
        const name = memberNames.peek(g, identity);
        if (name) return name;
      }
      return "";
    },
  });
}
