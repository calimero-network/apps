// World-level operations: resolve the application, list joinable worlds
// (contexts), create a world, mint and redeem invites. Everything here goes
// through `getTransport().admin` — a node's REST routes or an account's signed
// warrants, decided once in net/transport.ts — so this file knows nothing
// about URLs, tokens or relays.

import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from "@calimero-apps/invite";
import { getSession, updateSession } from "./session";
import {
  decodeInvite,
  encodeInvite,
  namespaceIdOfInvite,
} from "./inviteCodec";
import { getTransport, type ContextInfo } from "./transport";

export type { ContextInfo } from "./transport";
// The node path's parsers and the app-id rule, kept importable from here (the
// tests beside this file pin them).
export { packageOf, parseApplications, parseContexts, pickApplicationId } from "./nodeTransport";

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
 * Resolve the application id, never from configuration.
 *
 * Node: the node is asked even when the session already carries an id — a
 * remembered id survives switching nodes and reinstalling the app, and an id
 * this node doesn't know is worse than no id at all (see `pickApplicationId`).
 * Account: derived from the registry (package + publisher), the same on every
 * relay. Either way a session value that fails the check is cleared rather
 * than left to come back on the next call.
 */
export async function resolveApplicationId(): Promise<string | null> {
  const sessionAppId = getSession().applicationId ?? "";
  const id = await getTransport().admin.resolveApplicationId(sessionAppId);
  if (id !== sessionAppId) updateSession({ applicationId: id || null });
  return id || null;
}

/** worlds this player can enter (contexts of our application) */
export async function listWorlds(applicationId: string | null): Promise<ContextInfo[]> {
  const contexts = await getTransport().admin.listContexts();
  if (!applicationId) return contexts;
  // keep contexts with unknown applicationId — old nodes omit the field
  return contexts.filter((c) => !c.applicationId || c.applicationId === applicationId);
}

export interface CreatedWorld {
  contextId: string;
  memberPublicKey: string;
  namespaceId: string;
  groupId: string;
  /**
   * Account path: the cloud declined to host the new namespace (HA), in words
   * a player can act on — the world exists and is playable, but invitees may
   * find no node to admit them until this is sorted. Undefined on a node and
   * when hosting was granted.
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
  const initializationParams = Array.from(
    new TextEncoder().encode(
      JSON.stringify({ name, seed, now: Math.floor(Date.now() / 1000) }),
    ),
  );
  const { admin } = getTransport();
  // This is the human name that later travels inside every invite for this
  // world.
  const { namespaceId, haError } = await admin.createNamespace(applicationId, name);
  const groupId = await admin.createOpenGroup(namespaceId, name);
  const created = await admin.createContext(applicationId, groupId, name, initializationParams);
  return {
    contextId: created.contextId,
    memberPublicKey: created.memberPublicKey,
    namespaceId,
    groupId,
    ...(haError ? { haError } : {}),
  };
}

/** the identity this player owns for a context ("" when not a member) */
export async function ownedContextIdentity(contextId: string): Promise<string> {
  const owned = await getTransport().admin.identitiesOwned(contextId);
  return owned.length > 0 ? owned[0] : "";
}

/**
 * Join a context and PROVE it worked: after the join we must own an identity
 * for the context, or every later contract call fails with the node's
 * "No owned identity found for this context". The join call itself is
 * idempotent, so a real error from it is a real failure — never swallow it.
 * Returns the owned identity (the executor key for rpc calls).
 */
export async function joinWorld(contextId: string): Promise<string> {
  await getTransport().admin.joinContext(contextId);
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

/**
 * Namespace of the given world, resolving + caching into the session when
 * we joined the world without going through createWorld (picker / SSO).
 * The cache is only valid for the CURRENT world — with one namespace per
 * world, trusting a stale namespaceId would mint invites for the wrong world.
 */
async function resolveNamespaceForContext(contextId: string): Promise<string> {
  const s = getSession();
  if (s.namespaceId && s.contextId === contextId) return s.namespaceId;
  const { admin } = getTransport();
  const groupId = await admin.contextGroup(contextId);
  // Resolved, not read off the session: `for-application/<unknown id>` is one of
  // the routes that answers an id this node doesn't have with an opaque 500.
  const applicationId = (await resolveApplicationId()) ?? "";
  for (const nsId of await admin.namespacesForApplication(applicationId)) {
    if (nsId === groupId) {
      updateSession({ namespaceId: nsId, groupId });
      return nsId;
    }
    try {
      if ((await admin.namespaceGroups(nsId)).includes(groupId)) {
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
  const { admin } = getTransport();
  let visibility = "";
  try {
    visibility = await admin.groupVisibility(groupId);
  } catch {
    /* older node without group info — attempt the flip regardless */
  }
  if (visibility === "open") return;
  await admin.setGroupOpen(groupId);
}

/**
 * Mint a copyable invite string for the current world: a signed namespace
 * invitation (from the node, or signed by the account), wrapped with the
 * world's group+context ids and encoded deflate+base58 (see inviteCodec.ts).
 * Paste it on another client.
 */
export async function createWorldInvite(worldName?: string): Promise<string> {
  const s = getSession();
  if (!s.contextId) throw new Error("not in a shared world");
  const { admin } = getTransport();
  const namespaceId = await resolveNamespaceForContext(s.contextId);
  const knownGroupId = getSession().groupId || (await admin.contextGroup(s.contextId).catch(() => ""));
  if (knownGroupId && knownGroupId !== namespaceId) await ensureWorldOpen(knownGroupId);
  const minted = await admin.createNamespaceInvitation(namespaceId);
  // alias priority: explicit arg > what the node echoes > the name stored at
  // create/join time — so the world's name always travels with the invite
  const alias = worldName ?? minted.groupName ?? s.worldName ?? undefined;
  return encodeInvite({
    invitation: minted.invitation,
    groupAlias: alias,
    contextId: s.contextId,
    groupId: knownGroupId || undefined,
  });
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
 */
export async function acceptWorldInvite(input: string): Promise<string> {
  const payload = decodeInvite(input);
  if (!payload) throw new Error("that doesn't look like a valid invite code");
  const namespaceId = namespaceIdOfInvite(payload);
  if (!namespaceId) throw new Error("the invite carries no namespace");
  const { admin } = getTransport();

  const outcome = await redeemInvitation(
    { namespaceId, invitation: payload.invitation },
    {
      join: async () => {
        await admin.joinNamespace(namespaceId, payload.invitation, payload.groupAlias);
      },
      memberships: () => admin.listNamespaces(),
    },
  );
  if (outcome.status === "failed") throw new WorldInviteError(outcome);

  if (payload.groupId && payload.groupId !== namespaceId) {
    try {
      await admin.joinSubgroupInheritance(payload.groupId);
    } catch {
      // The subgroup may simply not have synced to this node yet — pull the
      // namespace once and retry before declaring failure.
      try {
        await admin.syncGroup(namespaceId);
        await admin.joinSubgroupInheritance(payload.groupId);
      } catch (second) {
        throw new Error(inviteJoinFailure(second));
      }
    }
  }

  let contextId = payload.contextId ?? "";
  if (!contextId) {
    // curb-style payload without a pinned context — take the group's first world
    let groupIds = payload.groupId ? [payload.groupId] : [];
    if (groupIds.length === 0) {
      groupIds = await admin.namespaceGroups(namespaceId).catch(() => [] as string[]);
    }
    for (const g of groupIds) {
      const ctxs = await admin.groupContexts(g).catch(() => [] as ContextInfo[]);
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
