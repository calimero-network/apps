// Admin-API helpers for the web flow: resolve the installed application,
// list joinable worlds (contexts), create a new world. Response envelopes
// vary across node versions, so every parser is shape-tolerant (the
// mero-design `res.identities ?? res.items ?? res` school of parsing).

import { getAccessToken, getSession, updateSession } from "./session";
import { PACKAGE_NAME } from "./auth";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  SignedInvitation,
} from "./inviteCodec";

export interface ContextInfo {
  contextId: string;
  applicationId: string;
}

function headers(): Record<string, string> {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function adminGet<T = unknown>(path: string): Promise<T> {
  const { nodeUrl } = getSession();
  const res = await fetch(`${nodeUrl}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

async function adminPost<T = unknown>(path: string, payload: unknown): Promise<T> {
  const { nodeUrl } = getSession();
  const res = await fetch(`${nodeUrl}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

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
 * Application id: session (URL hash wins — the mero-chat lesson) > installed
 * app matching our package name > lone installed app.
 */
export async function resolveApplicationId(): Promise<string | null> {
  const s = getSession();
  if (s.applicationId) return s.applicationId;
  const apps = parseApplications(await adminGet("/admin-api/applications"));
  const match = apps.find((a) => packageOf(a) === PACKAGE_NAME);
  const chosen = match ?? (apps.length === 1 ? apps[0] : undefined);
  const id = chosen ? appId(chosen) : "";
  if (id) updateSession({ applicationId: id });
  return id || null;
}

/** worlds this node can enter (contexts of our application) */
export async function listWorlds(applicationId: string | null): Promise<ContextInfo[]> {
  const contexts = parseContexts(await adminGet("/admin-api/contexts"));
  if (!applicationId) return contexts;
  // keep contexts with unknown applicationId — old nodes omit the field
  return contexts.filter((c) => !c.applicationId || c.applicationId === applicationId);
}

const NAMESPACE_NAME = "mero-blocks";

/** first field that exists, as a string ("" if none) */
const pick = (obj: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
};

/**
 * The app's namespace on this node (created once, reused for every world).
 * Worlds are subgroups inside it — the grouping model current cores require
 * (POST /admin-api/contexts rejects a context without a groupId).
 */
export async function ensureNamespace(applicationId: string): Promise<string> {
  try {
    const spaces = await adminGet<unknown>(`/admin-api/namespaces/for-application/${applicationId}`);
    const list = Array.isArray(spaces) ? (spaces as Record<string, unknown>[]) : [];
    if (list.length > 0) {
      const id = pick(list[0], "namespaceId", "namespace_id", "id");
      if (id) return id;
    }
  } catch {
    /* no namespaces yet (or older route shape) — create one below */
  }
  const created = await adminPost<Record<string, unknown>>("/admin-api/namespaces", {
    applicationId,
    upgradePolicy: "Automatic",
    name: NAMESPACE_NAME,
  });
  const id = pick(created, "namespaceId", "namespace_id", "id");
  if (!id) throw new Error("node did not return a namespace id");
  return id;
}

export interface CreatedWorld {
  contextId: string;
  memberPublicKey: string;
  namespaceId: string;
  groupId: string;
}

/**
 * Create a fresh world: ensure the app namespace, create a subgroup named
 * after the world, then create the context (the playable world state) inside
 * that subgroup. Returns every id the session needs (invites want ns+group).
 */
export async function createWorld(
  applicationId: string,
  name: string,
  seed: number,
): Promise<CreatedWorld> {
  const initializationParams = Array.from(
    new TextEncoder().encode(
      JSON.stringify({ name, seed, now: Math.floor(Date.now() / 1000) }),
    ),
  );
  const namespaceId = await ensureNamespace(applicationId);
  const group = await adminPost<Record<string, unknown>>(
    `/admin-api/namespaces/${namespaceId}/groups`,
    { name },
  );
  const groupId = pick(group, "groupId", "group_id", "id");
  if (!groupId) throw new Error("node did not return a group id");
  const data = await adminPost<Record<string, unknown>>("/admin-api/contexts", {
    applicationId,
    groupId,
    name,
    initializationParams,
  });
  return {
    contextId: String(data.contextId ?? data.id ?? ""),
    memberPublicKey: String(data.memberPublicKey ?? data.member_public_key ?? ""),
    namespaceId,
    groupId,
  };
}

/** join a context this node knows about (idempotent on most versions) */
export async function joinContext(contextId: string): Promise<void> {
  try {
    await adminPost(`/admin-api/contexts/${contextId}/join`, {});
  } catch {
    /* already joined / older node without the route — the rpc calls decide */
  }
}

// ---- invitations (the curb flow: namespace-level signed invite, encoded ----
// ---- deflate+base58; our payload additionally pins the world's context) ----

/** the subgroup a context lives in (GET .../group returns a bare id string) */
async function groupOfContext(contextId: string): Promise<string> {
  const data = await adminGet<unknown>(`/admin-api/contexts/${contextId}/group`);
  return typeof data === "string" ? data : "";
}

/**
 * Namespace of the current world, resolving + caching into the session when
 * we joined the world without going through createWorld (picker / SSO).
 */
async function resolveNamespaceForContext(contextId: string): Promise<string> {
  const s = getSession();
  if (s.namespaceId) return s.namespaceId;
  const groupId = await groupOfContext(contextId);
  const appId = s.applicationId ?? (await resolveApplicationId()) ?? "";
  const spaces = await adminGet<unknown>(`/admin-api/namespaces/for-application/${appId}`);
  const list = Array.isArray(spaces) ? (spaces as Record<string, unknown>[]) : [];
  for (const ns of list) {
    const nsId = pick(ns, "namespaceId", "namespace_id", "id");
    if (!nsId) continue;
    if (nsId === groupId) {
      updateSession({ namespaceId: nsId, groupId });
      return nsId;
    }
    try {
      const groups = await adminGet<unknown>(`/admin-api/namespaces/${nsId}/groups`);
      const entries = Array.isArray(groups) ? (groups as Record<string, unknown>[]) : [];
      if (entries.some((g) => pick(g, "groupId", "group_id", "id") === groupId)) {
        updateSession({ namespaceId: nsId, groupId });
        return nsId;
      }
    } catch {
      /* keep scanning the other namespaces */
    }
  }
  throw new Error("could not resolve this world's namespace");
}

/**
 * Mint a copyable invite string for the current world: a signed namespace
 * invitation from the node, wrapped with the world's group+context ids and
 * encoded deflate+base58 (see inviteCodec.ts). Paste it on another client.
 */
export async function createWorldInvite(worldName?: string): Promise<string> {
  const s = getSession();
  if (!s.contextId) throw new Error("not in a shared world");
  const namespaceId = await resolveNamespaceForContext(s.contextId);
  const res = await adminPost<Record<string, unknown>>(
    `/admin-api/namespaces/${namespaceId}/invite`,
    {},
  );
  const invitation = (res.invitation ?? res) as SignedInvitation;
  const groupId =
    getSession().groupId || (await groupOfContext(s.contextId).catch(() => "")) || undefined;
  return encodeInvite({
    invitation,
    groupAlias: worldName ?? (typeof res.groupName === "string" ? res.groupName : undefined),
    contextId: s.contextId,
    groupId,
  });
}

/**
 * Accept a pasted invite: join the namespace with the signed invitation,
 * self-join the world's subgroup via inheritance, then join the context.
 * Every step but the last tolerates "already a member". Returns the world's
 * contextId (also stored in the session — ready to enter).
 */
export async function acceptWorldInvite(input: string): Promise<string> {
  const payload = decodeInvite(input);
  if (!payload) throw new Error("that doesn't look like a valid invite code");
  const namespaceId = namespaceIdOfInvite(payload);
  if (!namespaceId) throw new Error("the invite carries no namespace");

  try {
    await adminPost(`/admin-api/namespaces/${namespaceId}/join`, {
      invitation: payload.invitation,
      ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
    });
  } catch {
    /* likely already a namespace member — the context join below decides */
  }

  if (payload.groupId && payload.groupId !== namespaceId) {
    try {
      await adminPost(`/admin-api/groups/${payload.groupId}/join-via-inheritance`, {});
    } catch {
      /* already in the subgroup, or open-visibility join not needed */
    }
  }

  let contextId = payload.contextId ?? "";
  if (!contextId) {
    // curb-style payload without a pinned context — take the group's first world
    let groupIds = payload.groupId ? [payload.groupId] : [];
    if (groupIds.length === 0) {
      const groups = await adminGet<unknown>(`/admin-api/namespaces/${namespaceId}/groups`).catch(() => []);
      groupIds = (Array.isArray(groups) ? (groups as Record<string, unknown>[]) : [])
        .map((g) => pick(g, "groupId", "group_id", "id"))
        .filter(Boolean);
    }
    for (const g of groupIds) {
      const ctxs = parseContexts(await adminGet(`/admin-api/groups/${g}/contexts`).catch(() => []));
      if (ctxs[0]) {
        contextId = ctxs[0].contextId;
        break;
      }
    }
  }
  if (!contextId) throw new Error("the invite does not reference a world");

  await joinContext(contextId);
  updateSession({ contextId, namespaceId, groupId: payload.groupId ?? null });
  return contextId;
}
