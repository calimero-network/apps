// A stand-in for the MeroJs instance MeroProvider would hand the app. The
// app's own api/ layer (meroJsClient, the three dataSources) runs unchanged on
// top of it; only the node on the other end of `admin.*` / `rpc.execute` is
// invented.
import {
  CONTEXTS,
  ME,
  NAMESPACE_ID,
  NAMESPACE_NAME,
  NOW_S,
  OTHER_NAMESPACES,
  P,
  PEOPLE,
  dmAliasFor,
  toB58Id,
  type Ctx,
  type Msg,
} from "./world";
import { markdownParser } from "../../src/utils/markdownParser";

// What the composer actually sends: the editor's HTML, run through the same
// markdownParser MessageEditor applies on submit (mentions become spans).
function composerHtml(text: string): string {
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a target="_blank" rel="noopener noreferrer nofollow" class="rich-text-link" href="$1">$1</a>',
    );
  return markdownParser(`<p>${html}</p>`, PEOPLE.map((p) => p.name));
}

type Scene = { empty?: boolean };
const scene: Scene = (globalThis as { __SHOT_SCENE__?: Scene }).__SHOT_SCENE__ ?? {};

const contexts = (): Ctx[] => (scene.empty ? [] : CONTEXTS);
const byContext = (id: string) => contexts().find((c) => c.contextId === toB58Id(id));
const bySubgroup = (id: string) => contexts().find((c) => c.subgroupId === id);

const unknownCalls = new Set<string>();
function note(kind: string, name: string) {
  const k = `${kind}.${name}`;
  if (!unknownCalls.has(k)) {
    unknownCalls.add(k);
    console.debug(`[fakeMero] unmodelled ${k}`);
  }
}

function toContractMsg(c: Ctx, msg: Msg) {
  const from = P[msg.from];
  const reactions: Record<string, string[]> = {};
  for (const [emoji, keys] of Object.entries(msg.reactions ?? {})) {
    reactions[emoji] = keys.map((k) => P[k].accountB58);
  }
  const ts = msg.sentAt ?? NOW_S - msg.minutesAgo * 60;
  const lastReply = msg.thread?.length ? msg.thread[msg.thread.length - 1] : undefined;
  return {
    id: msg.id,
    sender: from.accountB58,
    sender_username: from.name,
    text: msg.html ?? composerHtml(msg.text),
    timestamp: ts,
    deleted: false,
    edited_on: msg.edited ? ts + 120 : undefined,
    reactions,
    thread_count: msg.thread?.length ?? 0,
    thread_last_timestamp: lastReply ? NOW_S - lastReply.minutesAgo * 60 : 0,
    group: c.name,
    files: (msg.files ?? []).map((f, i) => ({
      ...f,
      blob_id: `${msg.id}-file-${i}`,
      uploaded_at: ts,
    })),
    images: [],
  };
}

function paginate<T>(all: T[], limit?: number, offset?: number) {
  const total = all.length;
  const lim = limit ?? total;
  const off = offset ?? 0;
  if (off >= total) return { total_count: total, messages: [], start_position: off };
  const end = total - off;
  const start = Math.max(0, end - lim);
  return { total_count: total, messages: all.slice(start, end), start_position: off + (end - start) };
}

function rpc(method: string, args: Record<string, unknown>, contextId: string): unknown {
  const c = byContext(contextId);
  if (!c) throw new Error(`no such context ${contextId}`);
  switch (method) {
    case "get_info":
      return {
        name: c.name,
        context_type: c.type,
        description:
          c.type === "Dm"
            ? JSON.stringify(
                c.creator === "me"
                  ? { c: ME.name, o: P[c.dmWith!].name }
                  : { c: P[c.dmWith!].name, o: ME.name },
              )
            : c.description ?? "",
        created_at: NOW_S - 86400 * 40,
        creator: P[c.creator].accountB58,
      };
    case "get_profiles":
      return c.members.map((k) => ({ identity: P[k].accountB58, username: P[k].name }));
    case "get_messages": {
      const parent = args.parent_message as string | undefined;
      let list = c.messages;
      if (parent) list = c.messages.find((x) => x.id === parent)?.thread ?? [];
      const term = (args.search_term as string | undefined)?.toLowerCase();
      if (term) list = list.filter((x) => x.text.toLowerCase().includes(term));
      return paginate(
        list.map((x) => toContractMsg(c, x)),
        args.limit as number | undefined,
        args.offset as number | undefined,
      );
    }
    // Paged by POSITION, as the contract's get_messages_from: [start, start+limit).
    case "get_message_count":
      return c.messages.length;
    case "get_messages_from": {
      const all = c.messages.map((x, i) => ({ ...toContractMsg(c, x), index: i }));
      const start = Number(args.start ?? 0);
      const lim = args.limit == null ? all.length : Number(args.limit);
      return { total_count: all.length, messages: all.slice(start, start + lim), start_position: start };
    }
    case "search_all_messages": {
      const term = String(args.search_term ?? "").toLowerCase();
      const hits = c.messages.filter((x) => x.text.toLowerCase().includes(term));
      return paginate(hits.map((x) => toContractMsg(c, x)).reverse(), args.limit as number, args.offset as number);
    }
    case "get_unread_count":
      return c.unread ?? 0;
    case "get_unread_mentions":
      return c.mentions ?? 0;
    case "list_roles":
      return c.members.map((k) => [P[k].accountB58, P[k].role === "Admin" ? "Admin" : "User"]);
    case "get_member_role": {
      const who = PEOPLE.find((p) => p.accountB58 === args.identity || p.accountHex === args.identity);
      return who?.role === "Admin" ? "Admin" : "User";
    }
    // Writes, so a recording can show the real composer and reactions at work.
    case "send_message": {
      const parent = args.parent_message as string | undefined;
      const msg: Msg = {
        id: `sent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        from: "me",
        text: "",
        html: String(args.message ?? ""),
        minutesAgo: 0,
        sentAt: Math.floor(Date.now() / 1000),
      };
      if (parent) {
        const p = c.messages.find((x) => x.id === parent);
        if (p) (p.thread ??= []).push(msg);
      } else {
        c.messages.push(msg);
      }
      return { ...toContractMsg(c, msg), index: c.messages.length - 1 };
    }
    case "update_reaction": {
      const target = c.messages.find((x) => x.id === args.message_id) ??
        c.messages.flatMap((x) => x.thread ?? []).find((x) => x.id === args.message_id);
      if (target) {
        const emoji = String(args.emoji);
        const who = new Set((target.reactions ??= {})[emoji] ?? []);
        if (args.add) who.add("me"); else who.delete("me");
        if (who.size) target.reactions[emoji] = [...who]; else delete target.reactions[emoji];
      }
      return null;
    }
    case "get_draft":
      return null;
    case "mark_as_read":
    case "mark_messages_as_read":
    case "set_member_role":
    case "set_profile":
    case "join_chat":
    case "save_draft":
    case "delete_draft":
      return "ok";
    default:
      note("rpc", method);
      return null;
  }
}

const groupNames = new Map<string, string>();

const admin: Record<string, (...a: never[]) => Promise<unknown>> = {
  async getGroupMetadata(groupId: string) {
    const name = groupNames.get(groupId) ?? bySubgroup(groupId)?.name ?? (groupId === NAMESPACE_ID ? NAMESPACE_NAME : undefined);
    return name ? { name } : null;
  },
  async setGroupMetadata(groupId: string, body: { name?: string }) {
    if (body?.name) groupNames.set(groupId, body.name);
    return null;
  },
  async listNamespaces() {
    return [
      { namespaceId: NAMESPACE_ID, name: NAMESPACE_NAME, createdAt: NOW_S - 86400 * 90 },
      ...OTHER_NAMESPACES.map((n, i) => ({ namespaceId: n.id, name: n.name, createdAt: NOW_S - 86400 * (30 + i) })),
    ];
  },
  async listNamespacesForApplication() {
    return admin.listNamespaces();
  },
  async getGroupInfo(groupId: string) {
    const c = bySubgroup(groupId);
    return {
      groupId,
      alias: c?.name ?? NAMESPACE_NAME,
      appKey: "",
      targetApplicationId: "",
      upgradePolicy: "Automatic",
      memberCount: c ? c.members.length : PEOPLE.length,
      contextCount: c ? 1 : contexts().length,
      activeUpgrade: null,
      defaultCapabilities: 0,
      subgroupVisibility: c?.visibility ?? "restricted",
    };
  },
  async listGroupMembers(groupId: string) {
    const c = bySubgroup(groupId);
    const keys = c ? c.members : PEOPLE.map((p) => p.key);
    return {
      members: keys.map((k) => ({ identity: P[k].accountHex, role: P[k].role, name: P[k].name })),
      selfIdentity: ME.accountHex,
    };
  },
  async listSubgroups(namespaceId: string) {
    if (namespaceId !== NAMESPACE_ID) return [];
    return contexts().map((c) => ({
      groupId: c.subgroupId,
      name: c.type === "Dm" ? dmAliasFor(c) : c.name,
    }));
  },
  async listGroupContexts(groupId: string) {
    const c = bySubgroup(groupId);
    if (!c) return [];
    return [{ contextId: c.contextId, alias: c.type === "Dm" ? dmAliasFor(c) : c.name }];
  },
  async getContextIdentitiesOwned(contextId: string) {
    const c = byContext(contextId);
    return { identities: c?.joined ? [c.selfIdentity] : [] };
  },
  async joinContext(contextId: string) {
    const c = byContext(contextId);
    if (!c || !c.members.includes("me")) throw new Error("not entitled");
    return { contextId: c.contextId, memberPublicKey: c.selfIdentity };
  },
  async getContextGroup(contextId: string) {
    return byContext(contextId)?.subgroupId ?? "";
  },
  async getMemberCapabilities() {
    return { capabilities: 0xff };
  },
  async getGroupUpgradeStatus() {
    return null;
  },
  async getContext(contextId: string) {
    return { id: contextId, applicationId: "curb", rootHash: "" };
  },
  async getContexts() {
    return { contexts: contexts().map((c) => ({ id: c.contextId })) };
  },
  async createNamespaceInvitation() {
    return {
      invitation: {
        invitation: {
          inviter_identity: ME.accountHex,
          group_id: NAMESPACE_ID,
          expiration_height: 0,
          secret_salt: Array.from({ length: 32 }, (_, i) => (i * 37) % 256),
          protocol: "near",
          network: "testnet",
          contract_id: "calimero",
        },
        inviter_signature: "3f".repeat(64),
      },
      groupAlias: NAMESPACE_NAME,
    };
  },
};

const adminProxy = new Proxy(admin, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    return async () => {
      note("admin", prop);
      return null;
    };
  },
});

export const fakeMero = {
  admin: adminProxy,
  rpc: {
    async execute<T>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T> {
      return rpc(params.method, params.argsJson ?? {}, params.contextId) as T;
    },
  },
  auth: new Proxy({}, { get: () => async () => null }),
};
