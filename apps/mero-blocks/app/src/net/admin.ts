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

/**
 * The node's error responses carry the actual reason in the body —
 * `{"error": "identity not eligible for inheritance-based join"}` or
 * `{"message": …}` / `{"data": {"error": …}}` depending on the handler.
 * Surface that text; a bare "HTTP 403" is useless in the UI.
 */
async function adminError(method: string, path: string, res: Response): Promise<Error> {
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
    /* non-JSON error body — fall back to the status line */
  }
  return new Error(detail || `${method} ${path}: HTTP ${res.status}`);
}

async function adminSend<T = unknown>(method: string, path: string, payload?: unknown): Promise<T> {
  const { nodeUrl } = getSession();
  const res = await fetch(`${nodeUrl}${path}`, {
    method,
    headers: headers(),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!res.ok) throw await adminError(method, path, res);
  const body = await res.json();
  return (body?.data ?? body) as T;
}

const adminGet = <T = unknown>(path: string): Promise<T> => adminSend<T>("GET", path);
const adminPost = <T = unknown>(path: string, payload: unknown): Promise<T> =>
  adminSend<T>("POST", path, payload);
const adminPut = <T = unknown>(path: string, payload: unknown): Promise<T> =>
  adminSend<T>("PUT", path, payload);

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

/** first field that exists, as a string ("" if none) */
const pick = (obj: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
};

export interface CreatedWorld {
  contextId: string;
  memberPublicKey: string;
  namespaceId: string;
  groupId: string;
}

/**
 * Create a fresh world: its OWN namespace (named after the world), an Open
 * subgroup inside it, then the context (the playable world state) in that
 * subgroup. One namespace per world keeps invite scope = exactly one world
 * (namespace invitations grant self-join into every Open subgroup below it),
 * and never creates worlds inside a namespace someone else invited us into.
 * `visibility: "open"` is what lets invited players self-join the subgroup
 * via inheritance — absent, the node defaults to "restricted" and invitees
 * die with "identity not eligible for inheritance-based join".
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
  // `name` is what current nodes expect; `alias` keeps older nodes working —
  // the exact pair curb sends. This is the human name that later travels
  // inside every invite for this world.
  const created = await adminPost<Record<string, unknown>>("/admin-api/namespaces", {
    applicationId,
    upgradePolicy: "Automatic",
    name,
    alias: name,
  });
  const namespaceId = pick(created, "namespaceId", "namespace_id", "id");
  if (!namespaceId) throw new Error("node did not return a namespace id");
  const group = await adminPost<Record<string, unknown>>(
    `/admin-api/namespaces/${namespaceId}/groups`,
    { groupName: name, visibility: "open" },
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

/** the identity this node owns for a context ("" when not a member) */
export async function ownedContextIdentity(contextId: string): Promise<string> {
  const data = await adminGet<unknown>(`/admin-api/contexts/${contextId}/identities-owned`);
  const obj = (data ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(data) ? data : ((obj.identities ?? obj.items ?? []) as unknown[]);
  return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : "";
}

/**
 * Join a context and PROVE it worked: after the join we must own an identity
 * for the context, or every later contract call fails with the node's
 * "No owned identity found for this context". The join call itself is
 * idempotent, so a real error from it is a real failure — never swallow it.
 * Returns the owned identity (the executor key for rpc calls).
 */
export async function joinWorld(contextId: string): Promise<string> {
  await adminPost(`/admin-api/contexts/${contextId}/join`, {});
  const identity = await ownedContextIdentity(contextId);
  if (!identity) {
    throw new Error(
      "joined the world's group, but this node holds no identity for its context — " +
        "sync with the host node and try again",
    );
  }
  return identity;
}

// ---- invitations (the curb flow: namespace-level signed invite, encoded ----
// ---- deflate+base58; our payload additionally pins the world's context) ----

/** the subgroup a context lives in (GET .../group returns a bare id string) */
async function groupOfContext(contextId: string): Promise<string> {
  const data = await adminGet<unknown>(`/admin-api/contexts/${contextId}/group`);
  return typeof data === "string" ? data : "";
}

/**
 * Namespace of the given world, resolving + caching into the session when
 * we joined the world without going through createWorld (picker / SSO).
 * The cache is only valid for the CURRENT world — with one namespace per
 * world, trusting a stale namespaceId would mint invites for the wrong world.
 */
async function resolveNamespaceForContext(contextId: string): Promise<string> {
  const s = getSession();
  if (s.namespaceId && s.contextId === contextId) return s.namespaceId;
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
 * Invited players join the subgroup by inheritance, which only works while
 * the subgroup is Open. Worlds are born open now, but worlds created before
 * that were born restricted — flip them at invite-mint time so old worlds
 * become shareable too.
 */
async function ensureWorldOpen(groupId: string): Promise<void> {
  let visibility = "";
  try {
    const info = await adminGet<Record<string, unknown>>(`/admin-api/groups/${groupId}`);
    visibility = pick(info, "subgroupVisibility", "subgroup_visibility").toLowerCase();
  } catch {
    /* older node without group info — attempt the flip regardless */
  }
  if (visibility === "open") return;
  await adminPut(`/admin-api/groups/${groupId}/settings/subgroup-visibility`, {
    subgroupVisibility: "open",
  });
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
  const knownGroupId =
    getSession().groupId || (await groupOfContext(s.contextId).catch(() => ""));
  if (knownGroupId && knownGroupId !== namespaceId) await ensureWorldOpen(knownGroupId);
  const res = await adminPost<Record<string, unknown>>(
    `/admin-api/namespaces/${namespaceId}/invite`,
    {},
  );
  const invitation = (res.invitation ?? res) as SignedInvitation;
  // alias priority: explicit arg > what the node echoes > the name stored at
  // create/join time — so the world's name always travels with the invite
  const alias =
    worldName ??
    (typeof res.groupName === "string" && res.groupName ? res.groupName : undefined) ??
    s.worldName ??
    undefined;
  return encodeInvite({
    invitation,
    groupAlias: alias,
    contextId: s.contextId,
    groupId: knownGroupId || undefined,
  });
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Accept a pasted invite: join the namespace with the signed invitation,
 * self-join the world's subgroup via inheritance, then join the context and
 * verify we own an identity for it. Only the namespace join tolerates
 * failure (it fails when we are already a member — the idempotent subgroup
 * join right after is the real membership check); every other failure is
 * surfaced with the node's actual error text, because silently continuing
 * used to drop players into worlds they never joined ("No owned identity
 * found for this context" on every contract call, and no peers visible).
 */
export async function acceptWorldInvite(input: string): Promise<string> {
  const payload = decodeInvite(input);
  if (!payload) throw new Error("that doesn't look like a valid invite code");
  const namespaceId = namespaceIdOfInvite(payload);
  if (!namespaceId) throw new Error("the invite carries no namespace");

  let namespaceJoinError: unknown = null;
  try {
    await adminPost(`/admin-api/namespaces/${namespaceId}/join`, {
      invitation: payload.invitation,
      ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
    });
  } catch (e) {
    namespaceJoinError = e; // maybe already a member — the subgroup join decides
  }

  if (payload.groupId && payload.groupId !== namespaceId) {
    try {
      await adminPost(`/admin-api/groups/${payload.groupId}/join-via-inheritance`, {});
    } catch {
      // The subgroup may simply not have synced to this node yet — pull the
      // namespace once and retry before declaring failure.
      try {
        await adminPost(`/admin-api/groups/${namespaceId}/sync`, {});
        await adminPost(`/admin-api/groups/${payload.groupId}/join-via-inheritance`, {});
      } catch (second) {
        throw new Error(inviteJoinFailure(second, namespaceJoinError));
      }
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

  const identity = await joinWorld(contextId);
  updateSession({
    contextId,
    namespaceId,
    groupId: payload.groupId ?? null,
    worldName: payload.groupAlias ?? null,
    executorPublicKey: identity,
  });
  return contextId;
}

/** turn the raw join errors into one actionable message */
function inviteJoinFailure(subgroupError: unknown, namespaceError: unknown): string {
  const subgroupMsg = msgOf(subgroupError);
  if (subgroupMsg.includes("not eligible for inheritance")) {
    return (
      "this world is not open to invited players — ask the host to press " +
      '"Invite friends" again on the latest app version (that re-opens the world) ' +
      "and send you a fresh invite"
    );
  }
  // A failed namespace join is usually the root cause (e.g. the host node is
  // offline and the join stream never opened) — prefer its message.
  return namespaceError ? `${msgOf(namespaceError)} (then: ${subgroupMsg})` : subgroupMsg;
}
