// World management over the session's admin surface: resolve the installed
// application, list joinable worlds (contexts), create a world, mint and
// accept invites. Every call goes through `getTransport().admin` — mero-js's
// `AdminApiClient` on a node, `createAccountAdmin` on an account — so this
// module never knows which it is talking to. Response envelopes vary across
// node versions, so every parser is shape-tolerant (the mero-design
// `res.identities ?? res.items ?? res` school of parsing).

import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from "@calimero-apps/invite";
import { HTTPError, type SignedGroupOpenInvitation as MeroSignedInvitation } from "@calimero-network/mero-js";
import { getSession, sessionKind, updateSession } from "./session";
import { getTransport } from "./transport";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
  SignedInvitation,
} from "./inviteCodec";

export { packageOf, parseApplications, pickApplicationId } from "./transport";

export interface ContextInfo {
  contextId: string;
  applicationId: string;
  /** human name of the world, when the node's context record carries one */
  name?: string;
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
 * Turn a failed call into something a player can act on. mero-js already
 * surfaces the node's own words (`{"error": "identity not eligible for
 * inheritance-based join"}` and the other spellings) as `explanation`; when
 * the body carried nothing, translate the status — a bare "HTTP 403" is
 * useless. `label` names the call (`POST …/join`) for those cases.
 */
function describeAdminFailure(label: string, err: unknown): Error {
  if (!(err instanceof HTTPError)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const s = err.status;
  if (err.explanation && s !== 0) return new AdminError(err.explanation, s);
  // The spellings mero-js does not read: `{"data": {"error": …}}` and
  // `{"data": {"message": …}}`, which some handlers answer with.
  const nested = nestedErrorText(err.bodyText);
  if (nested && s !== 0) return new AdminError(nested, s);
  if (s === 0) {
    // the node was never reached: it is down, the URL is wrong, or the
    // browser blocked the request — say so instead of leaking a TypeError
    const where = sessionKind() === "account" ? "your relay" : `your node at ${getSession().nodeUrl}`;
    return new AdminError(`can't reach ${where} — check that it's running and the URL is right`, 0);
  }
  if (s === 401 || s === 403) {
    return new AdminError(`the node rejected your session (HTTP ${s}) — disconnect and log in again`, s);
  }
  if (s === 404) {
    return new AdminError(
      `the node doesn't know this resource (${label}: HTTP 404) — ` +
        "it may not have synced yet, or the app isn't installed on it",
      s,
    );
  }
  if (s >= 500) {
    return new AdminError(`the node hit an internal error (${label}: HTTP ${s}) — try again in a moment`, s);
  }
  return new AdminError(`the node rejected the request (${label}: HTTP ${s})`, s);
}

function nestedErrorText(bodyText: string | undefined): string {
  if (!bodyText) return "";
  try {
    const body = JSON.parse(bodyText) as { data?: { error?: unknown; message?: unknown }; message?: unknown };
    for (const v of [body?.data?.error, body?.data?.message, body?.message]) {
      if (typeof v === "string" && v) return v;
    }
  } catch {
    /* not JSON */
  }
  return "";
}

/** run one admin call with player-facing failure copy */
async function call<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw describeAdminFailure(label, err);
  }
}

const admin = async () => (await getTransport()).admin;

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

// ---- world names ------------------------------------------------------
// The node doesn't reliably echo a context's name back on every version, so
// names learned at create/invite time are remembered locally per world and
// merged with whatever the node's context record carries.

const WORLD_NAMES_KEY = "mero-world-names";

function readWorldNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(WORLD_NAMES_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberWorldName(contextId: string, name: string | null | undefined): void {
  if (!contextId || !name) return;
  try {
    const names = readWorldNames();
    names[contextId] = name;
    localStorage.setItem(WORLD_NAMES_KEY, JSON.stringify(names));
  } catch {
    /* storage full — the world just stays unnamed */
  }
}

export function forgetWorldName(contextId: string): void {
  try {
    const names = readWorldNames();
    delete names[contextId];
    localStorage.setItem(WORLD_NAMES_KEY, JSON.stringify(names));
  } catch {
    /* nothing to forget */
  }
}

/** display name for a world: node record > remembered > "" */
export function worldNameOf(contextId: string, nodeName?: string): string {
  return nodeName || readWorldNames()[contextId] || "";
}

/**
 * Our application id, from the transport: what the node has installed
 * (checked, never trusted from the session alone — MRR6) or, for an account,
 * the registry's answer for our package.
 */
export async function resolveApplicationId(): Promise<string | null> {
  const t = await getTransport();
  return call("GET /applications", () => t.resolveApplicationId());
}

/** worlds this session can enter (contexts of our application) */
export async function listWorlds(applicationId: string | null): Promise<ContextInfo[]> {
  const a = await admin();
  const contexts = parseContexts(await call("GET /contexts", () => a.getContexts()));
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
  /**
   * Account only: the cloud's reason for NOT hosting the new world's
   * namespace (HA). The world exists either way; without hosting an invitee
   * with no node of their own cannot find it, so the picker shows this.
   */
  haError?: string;
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
  const a = await admin();
  const initializationParams = Array.from(
    new TextEncoder().encode(
      JSON.stringify({ name, seed, now: Math.floor(Date.now() / 1000) }),
    ),
  );
  // Body is EXACTLY `applicationId` + `name`. Core's `CreateNamespaceApiRequest`
  // carries `deny_unknown_fields`, so an extra key fails the whole create
  // (`alias` was the group label before core#2338 and is a 400 on every node).
  // This is the human name that later travels inside every invite for this
  // world. On an account the same call founds the namespace through the relay
  // and asks the cloud to host it; `haError` says when the cloud declined.
  const created = (await call("POST /namespaces", () =>
    a.createNamespace({ applicationId, name }),
  )) as unknown as Record<string, unknown>;
  const namespaceId = pick(created, "namespaceId", "namespace_id", "id");
  if (!namespaceId) throw new Error("node did not return a namespace id");
  const haError = typeof created.haError === "string" && created.haError ? created.haError : undefined;
  const group = (await call(`POST /namespaces/${namespaceId}/groups`, () =>
    a.createGroupInNamespace(namespaceId, { groupName: name, visibility: "open" }),
  )) as unknown as Record<string, unknown>;
  const groupId = pick(group, "groupId", "group_id", "id");
  if (!groupId) throw new Error("node did not return a group id");
  const data = (await call("POST /contexts", () =>
    a.createContext({ applicationId, groupId, name, initializationParams }),
  )) as unknown as Record<string, unknown>;
  return {
    contextId: String(data.contextId ?? data.id ?? ""),
    memberPublicKey: String(data.memberPublicKey ?? data.member_public_key ?? ""),
    namespaceId,
    groupId,
    ...(haError ? { haError } : {}),
  };
}

/** the identity this session owns for a context ("" when not a member) */
export async function ownedContextIdentity(contextId: string): Promise<string> {
  const a = await admin();
  const data = (await call(`GET /contexts/${contextId}/identities-owned`, () =>
    a.getContextIdentitiesOwned(contextId),
  )) as unknown;
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
  const a = await admin();
  await call(`POST /contexts/${contextId}/join`, () => a.joinContext(contextId));
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
  const a = await admin();
  const data = (await call(`GET /contexts/${contextId}/group`, () =>
    a.getContextGroup(contextId),
  )) as unknown;
  return typeof data === "string" ? data : "";
}

/** `[{groupId, …}]` → ids, tolerating every spelling */
const groupIds = (groups: unknown): string[] =>
  (Array.isArray(groups) ? (groups as Record<string, unknown>[]) : [])
    .map((g) => pick(g, "groupId", "group_id", "id"))
    .filter(Boolean);

/**
 * Namespace of the given world, resolving + caching into the session when
 * we joined the world without going through createWorld (picker / SSO).
 * The cache is only valid for the CURRENT world — with one namespace per
 * world, trusting a stale namespaceId would mint invites for the wrong world.
 */
async function resolveNamespaceForContext(contextId: string): Promise<string> {
  const s = getSession();
  if (s.namespaceId && s.contextId === contextId) return s.namespaceId;
  const a = await admin();
  const groupId = await groupOfContext(contextId);
  const appId = s.applicationId ?? (await resolveApplicationId()) ?? "";
  const spaces = (await call(`GET /namespaces/for-application/${appId}`, () =>
    a.listNamespacesForApplication(appId),
  )) as unknown;
  const list = Array.isArray(spaces) ? (spaces as Record<string, unknown>[]) : [];
  for (const ns of list) {
    const nsId = pick(ns, "namespaceId", "namespace_id", "id");
    if (!nsId) continue;
    if (nsId === groupId) {
      updateSession({ namespaceId: nsId, groupId });
      return nsId;
    }
    try {
      const groups = await a.listNamespaceGroups(nsId);
      if (groupIds(groups).includes(groupId)) {
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
  const a = await admin();
  let visibility = "";
  try {
    const info = (await a.getGroupInfo(groupId)) as unknown as Record<string, unknown>;
    visibility = pick(info ?? {}, "subgroupVisibility", "subgroup_visibility").toLowerCase();
  } catch {
    /* older node without group info — attempt the flip regardless */
  }
  if (visibility === "open") return;
  await call(`PUT /groups/${groupId}/settings/subgroup-visibility`, () =>
    a.setSubgroupVisibility(groupId, { subgroupVisibility: "open" }),
  );
}

/**
 * Mint a copyable invite string for the current world: a signed namespace
 * invitation (the node's, or one the account signs itself — naming the
 * relays that admit, so an invitee with no node can be let in), wrapped with
 * the world's group+context ids and encoded deflate+base58 (see
 * inviteCodec.ts). Paste it on another client.
 */
export async function createWorldInvite(worldName?: string): Promise<string> {
  const s = getSession();
  if (!s.contextId) throw new Error("not in a shared world");
  const a = await admin();
  const namespaceId = await resolveNamespaceForContext(s.contextId);
  const knownGroupId =
    getSession().groupId || (await groupOfContext(s.contextId).catch(() => ""));
  if (knownGroupId && knownGroupId !== namespaceId) await ensureWorldOpen(knownGroupId);
  const res = (await call(`POST /namespaces/${namespaceId}/invite`, () =>
    a.createNamespaceInvitation(namespaceId),
  )) as unknown as Record<string, unknown>;
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

/** namespace ids this session is a member of (`[{ namespaceId, … }]`) */
async function listNamespaceIds(): Promise<string[]> {
  const a = await admin();
  const data = (await call("GET /namespaces", () => a.listNamespaces())) as unknown;
  const obj = (data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(data) ? data : Array.isArray(obj.namespaces) ? obj.namespaces : [];
  return (list as Record<string, unknown>[])
    .map((ns) => pick(ns, "namespaceId", "namespace_id", "id"))
    .filter(Boolean);
}

type FailedRedeem = Extract<RedeemOutcome, { status: "failed" }>;

/**
 * The namespace join did not land. Carries the outcome so the invite modal can
 * tell a link that is finished with (expired, invalid, refused — ack it) from
 * one that failed for the moment (no one online, node unreachable — keep it
 * for the next load); the message is the player-facing copy for it.
 */
export class WorldInviteError extends Error {
  readonly outcome: FailedRedeem;
  constructor(outcome: FailedRedeem) {
    super(describeInviteFailure(outcome.reason, "world") ?? outcome.message);
    this.name = "WorldInviteError";
    this.outcome = outcome;
  }
}

/**
 * Accept a pasted invite: join the namespace with the signed invitation,
 * self-join the world's subgroup via inheritance, then join the context and
 * verify we own an identity for it.
 *
 * The namespace join goes through `redeemInvitation`, which sends it once and
 * decides membership by the namespace being listed as well as by the request
 * resolving — a join the desktop proxy aborted at 30s, or a link followed
 * twice, is "already a member", not a failure. A join that really failed
 * throws `WorldInviteError`. Every later failure is surfaced with the node's
 * actual error text, because silently continuing used to drop players into
 * worlds they never joined ("No owned identity found for this context" on
 * every contract call, and no peers visible).
 *
 * On an account the namespace join is `joinAsAccount`: the invitation's
 * admitting relay carries the signed join and the session moves onto that
 * relay (the transport rebuilds itself), so everything after it runs there.
 */
export async function acceptWorldInvite(input: string): Promise<string> {
  const payload = decodeInvite(input);
  if (!payload) throw new Error("that doesn't look like a valid invite code");
  const namespaceId = namespaceIdOfInvite(payload);
  if (!namespaceId) throw new Error("the invite carries no namespace");

  const outcome = await redeemInvitation(
    { namespaceId, invitation: payload.invitation },
    {
      join: async () => {
        const a = await admin();
        await call(`POST /namespaces/${namespaceId}/join`, () =>
          a.joinNamespace(namespaceId, {
            invitation: payload.invitation as unknown as MeroSignedInvitation,
            ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
          }),
        );
      },
      memberships: listNamespaceIds,
    },
  );
  if (outcome.status === "failed") throw new WorldInviteError(outcome);

  // from here on `admin()` may be a NEW transport (an account's first relay)
  if (payload.groupId && payload.groupId !== namespaceId) {
    const subgroup = payload.groupId;
    const joinSubgroup = async () => {
      const a = await admin();
      await call(`POST /groups/${subgroup}/join-via-inheritance`, () =>
        a.joinSubgroupInheritance(subgroup),
      );
    };
    try {
      await joinSubgroup();
    } catch {
      // The subgroup may simply not have synced to this node yet — pull the
      // namespace once and retry before declaring failure.
      try {
        const a = await admin();
        await call(`POST /groups/${namespaceId}/sync`, () => a.syncGroup(namespaceId));
        await joinSubgroup();
      } catch (second) {
        throw new Error(inviteJoinFailure(second));
      }
    }
  }

  let contextId = payload.contextId ?? "";
  if (!contextId) {
    // curb-style payload without a pinned context — take the group's first world
    const a = await admin();
    let ids = payload.groupId ? [payload.groupId] : [];
    if (ids.length === 0) ids = groupIds(await a.listNamespaceGroups(namespaceId).catch(() => []));
    for (const g of ids) {
      const ctxs = parseContexts(await a.listGroupContexts(g).catch(() => []));
      if (ctxs[0]) {
        contextId = ctxs[0].contextId;
        break;
      }
    }
  }
  if (!contextId) throw new Error("the invite does not reference a world");

  const identity = await joinWorld(contextId);
  rememberWorldName(contextId, payload.groupAlias);
  updateSession({
    contextId,
    namespaceId,
    groupId: payload.groupId ?? null,
    worldName: payload.groupAlias ?? null,
    executorPublicKey: identity,
  });
  return contextId;
}

/**
 * Turn the subgroup join's raw error into an actionable message. The namespace
 * join is already known to have landed by now (see `acceptWorldInvite`), so
 * this error is the whole story.
 */
function inviteJoinFailure(subgroupError: unknown): string {
  const subgroupMsg = msgOf(subgroupError);
  if (subgroupMsg.includes("not eligible for inheritance")) {
    return (
      "this world is not open to invited players — ask the host to press " +
      '"Invite friends" again on the latest app version (that re-opens the world) ' +
      "and send you a fresh invite"
    );
  }
  return subgroupMsg;
}
