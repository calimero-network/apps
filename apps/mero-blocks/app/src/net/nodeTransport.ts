// The NODE transport: the player's own merod, bearer token, REST admin routes,
// `/jsonrpc` for the contract, `/sse` for events. This is the wire the app
// always had — the routes, bodies and error translation moved here from
// admin.ts byte for byte so the node path stays exactly what it was.

import { SseClient } from "@calimero-network/mero-js";
import { PACKAGE_NAME } from "./auth";
import type { SignedInvitation } from "./inviteCodec";
import { rpcExecute } from "./rpc";
import { getAccessToken, getSession } from "./session";
import type { AdminOps, ContextInfo, EventStream, Transport } from "./transport";

function headers(): Record<string, string> {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * An admin request that failed, carrying the HTTP status (`0` when the node
 * was never reached) so `@calimero-apps/invite` can tell a refused invitation
 * from a node that is only busy.
 */
export class AdminError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminError";
    this.status = status;
  }
}

/**
 * The node's error responses carry the actual reason in the body —
 * `{"error": "identity not eligible for inheritance-based join"}` or
 * `{"message": …}` / `{"data": {"error": …}}` depending on the handler.
 * Surface that text; when the body carries nothing, translate the status
 * into something a player can act on — a bare "HTTP 403" is useless.
 */
async function adminError(method: string, path: string, res: Response): Promise<AdminError> {
  let detail = "";
  try {
    const body = (await res.json()) as Record<string, unknown>;
    for (const v of [
      body?.error,
      body?.message,
      (body?.data as Record<string, unknown>)?.error,
      (body?.data as Record<string, unknown>)?.message,
    ]) {
      if (typeof v === "string" && v) {
        detail = v;
        break;
      }
    }
  } catch {
    /* non-JSON error body — fall back to the status text below */
  }
  const s = res.status;
  if (detail) return new AdminError(detail, s);
  if (s === 401 || s === 403) {
    return new AdminError(
      `the node rejected your session (HTTP ${s}) — disconnect and log in again`,
      s,
    );
  }
  if (s === 404) {
    return new AdminError(
      `the node doesn't know this resource (${method} ${path}: HTTP 404) — ` +
        "it may not have synced yet, or the app isn't installed on it",
      s,
    );
  }
  if (s >= 500) {
    return new AdminError(
      `the node hit an internal error (${method} ${path}: HTTP ${s}) — try again in a moment`,
      s,
    );
  }
  return new AdminError(`the node rejected the request (${method} ${path}: HTTP ${s})`, s);
}

async function adminSend<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {
  const { nodeUrl } = getSession();
  let res: Response;
  try {
    res = await fetch(`${nodeUrl}${path}`, {
      method,
      headers: headers(),
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    // fetch itself failed (the "HTTP 0" case): the node is down, the URL is
    // wrong, or the browser blocked the request — say so instead of leaking
    // a bare TypeError at the player.
    throw new AdminError(
      `can't reach your node at ${nodeUrl} — check that it's running and the URL is right`,
      0,
    );
  }
  if (!res.ok) throw await adminError(method, path, res);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

const adminGet = <T = unknown>(path: string): Promise<T> => adminSend<T>("GET", path);
const adminPost = <T = unknown>(path: string, payload: unknown): Promise<T> =>
  adminSend<T>("POST", path, payload);
const adminPut = <T = unknown>(path: string, payload: unknown): Promise<T> =>
  adminSend<T>("PUT", path, payload);

// ---- shape-tolerant parsers (response envelopes vary across node versions;
// ---- the mero-design `res.identities ?? res.items ?? res` school) ---------

/** unwrap {apps: []} | {applications: []} | [] */
export function parseApplications(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = (data ?? {}) as Record<string, unknown>;
  for (const key of ["apps", "applications", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/** unwrap {contexts: []} | [] and normalize id fields */
export function parseContexts(data: unknown): ContextInfo[] {
  let list: Record<string, unknown>[] = [];
  if (Array.isArray(data)) list = data as Record<string, unknown>[];
  else {
    const obj = (data ?? {}) as Record<string, unknown>;
    for (const key of ["contexts", "items"]) {
      if (Array.isArray(obj[key])) {
        list = obj[key] as Record<string, unknown>[];
        break;
      }
    }
  }
  return list
    .map((c) => ({
      contextId: String(c.contextId ?? c.id ?? ""),
      applicationId: String(c.applicationId ?? c.application_id ?? ""),
      name: String(c.name ?? c.contextName ?? c.context_name ?? "") || undefined,
    }))
    .filter((c) => c.contextId);
}

/** the package id of an application record, wherever this node version put it */
export function packageOf(app: Record<string, unknown>): string {
  const direct = app.package ?? app.packageName ?? app.package_name;
  if (typeof direct === "string" && direct) return direct;
  const manifest = app.manifest as Record<string, unknown> | undefined;
  if (manifest && typeof manifest.package === "string") return manifest.package;
  // some versions serialize metadata as bytes of the manifest json
  if (Array.isArray(app.metadata)) {
    try {
      const text = new TextDecoder().decode(new Uint8Array(app.metadata as number[]));
      const parsed = JSON.parse(text);
      if (typeof parsed?.package === "string") return parsed.package;
    } catch {
      /* metadata was not manifest json */
    }
  }
  return "";
}

const appId = (app: Record<string, unknown>): string =>
  String(app.id ?? app.applicationId ?? app.application_id ?? "");

/**
 * Pick our application id out of the node's installed apps.
 *
 * Order: the id this session was handed (the SSO/auth-callback hash, which the
 * desktop fills in — the mero-chat lesson: the URL beats anything remembered) >
 * the installed app carrying our package name > the lone app on a dev node.
 *
 * Every candidate is a PREFERENCE, checked against what this node actually has;
 * none of them is an override. There is deliberately no `VITE_APPLICATION_ID`
 * here and there must never be one: the id is `hash(package, signer)`, so it is
 * per-install and differs between a registry-signed release and a local
 * `cargo mero bundle --dev` of the same code. A baked id cannot be right for
 * both, and being wrong is not recoverable at runtime — the node answers a
 * request carrying an unknown application with an opaque `500` that never
 * mentions application ids (MeroDesign shipped a build wedged exactly that way).
 *
 * This is the NODE path's rule. An account has no node to ask and derives the
 * id from the registry instead (accountTransport.ts).
 */
export function pickApplicationId(
  apps: Record<string, unknown>[],
  sessionAppId: string,
): string {
  if (sessionAppId && apps.some((a) => appId(a) === sessionAppId)) return sessionAppId;
  const match = apps.find((a) => packageOf(a) === PACKAGE_NAME);
  const chosen = match ?? (apps.length === 1 ? apps[0] : undefined);
  return chosen ? appId(chosen) : "";
}

/** first field that exists, as a string ("" if none) */
const pick = (obj: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
};

const ids = (data: unknown): string[] => {
  const obj = (data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(obj.namespaces) ? obj.namespaces : [];
  return (list as Record<string, unknown>[])
    .map((ns) => pick(ns, "namespaceId", "namespace_id", "id"))
    .filter(Boolean);
};

const nodeAdmin: AdminOps = {
  async resolveApplicationId(sessionAppId) {
    const apps = parseApplications(await adminGet("/admin-api/applications"));
    return pickApplicationId(apps, sessionAppId);
  },
  async listContexts() {
    return parseContexts(await adminGet("/admin-api/contexts"));
  },
  async createNamespace(applicationId, name) {
    // Body is EXACTLY `applicationId` + `name` (+ optional `appKey`). Core's
    // `CreateNamespaceApiRequest` carries `deny_unknown_fields`, so an extra key
    // fails the whole create:
    //   Invalid JSON data: unknown field `alias`,
    //   expected one of `applicationId`, `name`, `appKey`, `bytecodeId`
    // `alias` was the group label before core#2338 replaced it with the generic
    // metadata record; `name` has been the only spelling since. Sending both was
    // never "compatible with older nodes" — it is a 400 on every node that has
    // the closed body, which is all of them.
    const created = await adminPost<Record<string, unknown>>("/admin-api/namespaces", {
      applicationId,
      name,
    });
    const namespaceId = pick(created, "namespaceId", "namespace_id", "id");
    if (!namespaceId) throw new Error("node did not return a namespace id");
    return { namespaceId };
  },
  async createOpenGroup(namespaceId, name) {
    const group = await adminPost<Record<string, unknown>>(
      `/admin-api/namespaces/${namespaceId}/groups`,
      { groupName: name, visibility: "open" },
    );
    const groupId = pick(group, "groupId", "group_id", "id");
    if (!groupId) throw new Error("node did not return a group id");
    return groupId;
  },
  async createContext(applicationId, groupId, name, initializationParams) {
    const data = await adminPost<Record<string, unknown>>("/admin-api/contexts", {
      applicationId,
      groupId,
      name,
      initializationParams,
    });
    return {
      contextId: String(data.contextId ?? data.id ?? ""),
      memberPublicKey: String(data.memberPublicKey ?? data.member_public_key ?? ""),
    };
  },
  async identitiesOwned(contextId) {
    const data = await adminGet<unknown>(`/admin-api/contexts/${contextId}/identities-owned`);
    const obj = (data ?? {}) as Record<string, unknown>;
    const arr = Array.isArray(data) ? data : ((obj.identities ?? obj.items ?? []) as unknown[]);
    return Array.isArray(arr) ? arr.map(String) : [];
  },
  async joinContext(contextId) {
    await adminPost(`/admin-api/contexts/${contextId}/join`, {});
  },
  async contextGroup(contextId) {
    // GET .../group returns a bare id string
    const data = await adminGet<unknown>(`/admin-api/contexts/${contextId}/group`);
    return typeof data === "string" ? data : "";
  },
  async namespacesForApplication(applicationId) {
    const spaces = await adminGet<unknown>(`/admin-api/namespaces/for-application/${applicationId}`);
    return ids(spaces);
  },
  async namespaceGroups(namespaceId) {
    const groups = await adminGet<unknown>(`/admin-api/namespaces/${namespaceId}/groups`);
    const entries = Array.isArray(groups) ? (groups as Record<string, unknown>[]) : [];
    return entries.map((g) => pick(g, "groupId", "group_id", "id")).filter(Boolean);
  },
  async groupVisibility(groupId) {
    const info = await adminGet<Record<string, unknown>>(`/admin-api/groups/${groupId}`);
    return pick(info, "subgroupVisibility", "subgroup_visibility").toLowerCase();
  },
  async setGroupOpen(groupId) {
    await adminPut(`/admin-api/groups/${groupId}/settings/subgroup-visibility`, {
      subgroupVisibility: "open",
    });
  },
  async createNamespaceInvitation(namespaceId) {
    const res = await adminPost<Record<string, unknown>>(`/admin-api/namespaces/${namespaceId}/invite`, {});
    return {
      invitation: (res.invitation ?? res) as SignedInvitation,
      groupName: typeof res.groupName === "string" && res.groupName ? res.groupName : undefined,
    };
  },
  async listNamespaces() {
    return ids(await adminGet<unknown>("/admin-api/namespaces"));
  },
  async joinNamespace(namespaceId, invitation, groupName) {
    await adminPost(`/admin-api/namespaces/${namespaceId}/join`, {
      invitation,
      ...(groupName ? { groupName } : {}),
    });
  },
  async joinSubgroupInheritance(groupId) {
    await adminPost(`/admin-api/groups/${groupId}/join-via-inheritance`, {});
  },
  async syncGroup(groupId) {
    await adminPost(`/admin-api/groups/${groupId}/sync`, {});
  },
  async groupContexts(groupId) {
    return parseContexts(await adminGet(`/admin-api/groups/${groupId}/contexts`));
  },
};

export function createNodeTransport(): Transport {
  return {
    kind: "node",
    admin: nodeAdmin,
    ready: () => Promise.resolve(),
    exec: (contextId, method, args) => {
      const s = getSession();
      return rpcExecute(
        { nodeUrl: s.nodeUrl ?? "", contextId, getToken: getAccessToken, executorPublicKey: s.executorPublicKey },
        method,
        args,
      );
    },
    openEvents(): EventStream | null {
      const s = getSession();
      if (!s.nodeUrl) return null;
      return new SseClient({
        baseUrl: s.nodeUrl,
        getAuthToken: async () => getAccessToken() ?? "",
        reconnectDelayMs: 8000,
      }) as unknown as EventStream;
    },
    /**
     * My per-context identity: the hash, else what the NODE reports owning.
     *
     * There is deliberately no cached fallback. This used to end in
     * `localStorage.getItem(cacheKey)`, which meant a node that owns no identity
     * for the context still produced one — so the app rendered as if it had
     * joined and every contract call then failed with "No owned identity found
     * for this context". A cache that answers when the node cannot is not a
     * fallback, it is a lie about membership; `null` is the honest answer and
     * boot() acts on it.
     */
    async resolveMyId(contextId) {
      const s = getSession();
      if (s.executorPublicKey) return s.executorPublicKey;
      const owned = await nodeAdmin.identitiesOwned(contextId).catch(() => [] as string[]);
      return owned[0] || null;
    },
  };
}
