// ── Namespaces, audiences, invitations ────────────────────────────────────────────
//
// The model, with the vocabulary kept straight deliberately: a "group" is a
// SUBGROUP inside a namespace, never the namespace itself.
//
//   Namespace  = the space that holds audiences        ← invite people here
//     └── Subgroup ("audience") + Context          ← one discussion board
//     └── Subgroup ("audience") + Context
//
// Every step here is proven by `app/e2e/two-node-suite.mjs` over raw HTTP; this
// module is the same sequence through mero-js, so the UI does what the suite
// asserts rather than an approximation of it. Two findings from that suite are
// encoded below and are the whole reason audiences work at all:
//
//   1. JOINING A NAMESPACE DOES NOT PUT YOU IN ITS ROOMS. `VisibilityMode`
//      defaults to RESTRICTED, and a restricted subgroup is unreachable by the
//      members you just invited — `join-via-inheritance` returns 403.
//   2. The wire value is LOWERCASE. Core rejects "Open" with
//      `Field 'subgroup_visibility' has invalid format: must be 'open' or
//      'restricted'`. mero-js types it as a bare `string`, so nothing catches the
//      casing at compile time.
//
// Kept out of the components on purpose: these are multi-call sequences with
// retry and fallback in them, they are the part most likely to need a fix, and a
// component is the worst place to unit-test one.

import { CAPABILITIES, type MeroJs } from "@calimero-network/mero-js";
import {
  encodeInvite,
  groupIdOfInvite,
  type InviteChainEntry,
  type SignedInvitation,
  type AudienceInvitePayload,
} from "./inviteCodec";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";

/** The admin client, as `useMero().mero.admin` provides it. */
export type AdminLike = MeroJs["admin"];

/**
 * Progress sink. Every flow in here is several round-trips deep, and a single
 * "Working…" for six seconds of network is the difference between "loading" and
 * "broken" from the user's side — so each step names itself.
 */
export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/**
 * What an invited MEMBER may do in a space.
 *
 * ── Why this is not 15 ───────────────────────────────────────────────────────
 *
 * It was. `15` came over from mero-stream with this module, where the comment
 * read "members who cannot post chunks are of no use here" — a fair call for a
 * video app. Two things are wrong with it here, and they pull in opposite
 * directions:
 *
 *   1. **15 includes MANAGE_MEMBERS (1 << 3).** So every person you invited to
 *      a space could change anyone's role, including demoting you. There was no
 *      role system to speak of, only the appearance of one: everyone admitted
 *      was an admin.
 *
 *   2. **15 does NOT include the bits `createAudience` actually needs** —
 *      CAN_CREATE_SUBGROUP (1 << 5), CAN_MANAGE_VISIBILITY (1 << 7) and
 *      CAN_MANAGE_METADATA (1 << 8). The namespace OWNER holds full
 *      capabilities independently of this default, so creating an audience worked
 *      for whoever made the space and failed for everyone they invited.
 *
 * So the old default simultaneously over-granted governance and under-granted
 * the thing a member is there to do.
 *
 * The bits below are derived from this app's own call sites, not chosen:
 *
 *   createAudience()   →  createGroupInNamespace    CAN_CREATE_SUBGROUP
 *                      setGroupMetadata          CAN_MANAGE_METADATA
 *                      setSubgroupVisibility     CAN_MANAGE_VISIBILITY
 *                      createContext             CAN_CREATE_CONTEXT
 *   mint*Invite()   →  createNamespaceInvitation CAN_INVITE_MEMBERS
 *   enterAudience()    →  joinSubgroupInheritance   CAN_JOIN_OPEN_SUBGROUPS
 *   (admin only)    →  updateMemberRole          MANAGE_MEMBERS
 *
 * An audience is collaborative, so a Member gets everything except the last one:
 * they can read, post, start a new audience and invite people. What they cannot do
 * is change who governs the space.
 *
 * ⚠️ Deliberately withheld from BOTH roles: CAN_AUTHOR_ON_BEHALF (1 << 9),
 * which lets a node publish writes attributed to another member, and
 * MANAGE_APPLICATION (1 << 4). No call site here needs either, and the first
 * would let one member post under another's name — in an app whose whole
 * premise is who said what.
 */
export const MEMBER_CAPABILITIES =
  CAPABILITIES.CAN_CREATE_CONTEXT |
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_MANAGE_METADATA;

/** A Member, plus the one bit that governs the space. */
export const ADMIN_CAPABILITIES =
  MEMBER_CAPABILITIES | CAPABILITIES.MANAGE_MEMBERS;

/** How long to wait for a joined context's identity to land, and how often to look. */
const IDENTITY_TIMEOUT_MS = 60_000;
const IDENTITY_POLL_MS = 1_500;

/** How long to keep asking an audience to admit us while the grant projects. */
const ADMISSION_TIMEOUT_MS = 20_000;
const ADMISSION_POLL_MS = 1_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descend an invitation response until we reach the object that actually carries
 * the signature. The join endpoints want the invitation OBJECT — not a JSON
 * string of it, and not a wrapper around it. Same trap `dev-invite.sh` hit.
 */
export function unwrapInvitation(payload: unknown): SignedInvitation | null {
  let node: unknown = payload;
  for (let i = 0; i < 5; i++) {
    if (!node || typeof node !== "object") return null;
    const o = node as Record<string, unknown>;
    if ("inviter_signature" in o || "inviterSignature" in o) {
      return o as unknown as SignedInvitation;
    }
    if ("invitation" in o) node = o.invitation;
    else return null;
  }
  return null;
}

/** `init(name)` takes JSON bytes — see the contract's `init`. */
/**
 * The bytes handed to the contract's `init`.
 *
 * ⚠️ **`MeroAudience::init()` TAKES NO ARGUMENTS.** This module was ported from
 * mero-stream, whose `init(name: String)` does, and the `{name}` payload came
 * with it. The runtime does not ignore a surplus field — it panics inside the
 * guest and the whole create fails with
 *
 *     HTTP 400: application initialization failed: guest panicked:
 *     init: takes no arguments, but the call sent unknown field(s): ["name"]
 *
 * which names the contract, not the caller that sent it. The audience's name lives
 * in the subgroup's metadata record (see `createAudience`), which is where the
 * list reads it from — the contract never needed it.
 *
 * `{}` rather than an empty byte array: the runtime expects a JSON object for
 * the argument map, and an empty body is a different shape.
 */
function initParams(): number[] {
  return Array.from(new TextEncoder().encode("{}"));
}

/**
 * A join that is already satisfied is a SUCCESS, not a failure. Re-pasting a code,
 * a retry after a timeout, and walking a recursive chain that overlaps memberships
 * you already have all land here — and every one of them should end with the user
 * in the audience rather than staring at "already a member" styled as an error.
 */
function isAlreadyMember(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes("already a member") ||
    m.includes("already member") ||
    m.includes("already joined") ||
    m.includes("alreadyjoined") ||
    m.includes("duplicate member")
  );
}

// ── Namespaces ────────────────────────────────────────────────────────────────

export interface NamespaceRow {
  namespaceId: string;
  name: string;
  memberCount: number;
  audienceCount: number;
}

export async function listSpaceNamespaces(
  admin: AdminLike,
  applicationId: string,
): Promise<NamespaceRow[]> {
  const namespaces = await admin.listNamespacesForApplication(applicationId);
  return (namespaces ?? []).map((n) => ({
    namespaceId: n.namespaceId,
    name: (n.name ?? "").trim() || `Space ${n.namespaceId.slice(0, 6)}`,
    memberCount: n.memberCount ?? 0,
    // `subgroupCount` is the audience count. Prefer it over listing every namespace's
    // groups: that would be one request per row just to render a number.
    audienceCount: n.subgroupCount ?? 0,
  }));
}

/**
 * Create the namespace that holds a space's audiences.
 *
 * No context is created here — that is an audience's job. A namespace with no audience is
 * a valid, expected state: you invite people to the namespace, then make audiences.
 */
export async function createSpaceNamespace(
  admin: AdminLike,
  opts: { applicationId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string }> {
  onStatus("Creating the namespace…");
  const ns = await admin.createNamespace({
    applicationId: opts.applicationId,
    name: opts.name,
  });

  onStatus("Granting member capabilities…");
  // ⚠️ NOT SWALLOWED, AND THAT CHANGED AT rc.41.
  //
  // This call used to end `.catch(() => {})`, with the note "a failure here
  // costs invitees their permissions rather than breaking the namespace". That
  // was true while core seeded a new namespace with `CAN_JOIN_OPEN_SUBGROUPS`
  // and nothing else: losing this write left invitees with the ability to enter
  // open subgroups, which is what they were being given anyway.
  //
  // 0.11.0-rc.41 changed the seed. `initial_default_capabilities` in core's
  // `crates/context/src/handlers/create_group.rs` now returns
  //
  //     CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF
  //
  // for a namespace root (#3969), and rc.41 also publishes it as a governance
  // op so it REPLICATES to every peer (#3974). `CAN_AUTHOR_ON_BEHALF` is write
  // as somebody else, under a warrant they signed.
  //
  // So the cost of losing this write inverted: it no longer withholds a
  // capability, it GRANTS one, to everyone invited, permanently, and silently.
  // A swallowed failure is now a privilege escalation with no error anywhere.
  // Failing loudly while the creator is still looking at the screen is the only
  // honest option.
  await admin.setDefaultCapabilities(ns.namespaceId, {
    defaultCapabilities: MEMBER_CAPABILITIES,
  });

  onStatus("Opening the namespace to invited members…");
  await admin
    .setSubgroupVisibility(ns.namespaceId, { subgroupVisibility: "open" })
    .catch(() => {});

  return { namespaceId: ns.namespaceId };
}

// ── Audiences (subgroups) ─────────────────────────────────────────────────────────

/**
 * Where a redeemed invitation should land the user.
 *
 * Returned rather than navigated to, because the two callers that redeem — the
 * paste field and the link prompt — live in different parts of the tree and only
 * the audienceer knows how it wants to route.
 */
export type Redeemed =
  | {
      kind: "audience";
      contextId: string;
      identity: string;
      audienceName?: string;
      /**
       * The space this audience belongs to, when the invitation named it. Carried
       * so the audience can offer a way back to the audience list: a context knows
       * nothing about its namespace, and the admin API has no "parent of" read.
       */
      namespaceId?: string;
    }
  | { kind: "namespace"; namespaceId: string }
  | { kind: "joined" };

/**
 * Accept an invitation and enter whatever it granted.
 *
 * Extracted so the paste path and the link path cannot drift: they used to be one
 * inline sequence in CompaniesPage, which meant the app-wide invitation prompt
 * either had to duplicate it or could not exist. An audience invitation needs BOTH
 * joins — the namespace grant and then the audience's context — and forgetting the
 * second leaves someone a member of a space staring at an audience they cannot open.
 */
export async function redeemInvite(
  admin: AdminLike,
  payload: AudienceInvitePayload,
  onStatus: (message: string) => void,
): Promise<Redeemed> {
  const accepted = await acceptInvite(admin, payload, onStatus);

  // The grant has landed; the namespace's own state has not. Flag it so the
  // list this joiner is about to see says "syncing" rather than rendering an
  // empty view that is indistinguishable from an empty audiences.
  if (accepted.namespaceId) markNamespaceJustJoined(accepted.namespaceId);

  if (accepted.audienceId && accepted.contextId) {
    const identity = await enterAudienceContext(
      admin,
      { audienceId: accepted.audienceId, contextId: accepted.contextId },
      onStatus,
    );
    return {
      kind: "audience",
      contextId: accepted.contextId,
      identity,
      audienceName: accepted.audienceName,
      namespaceId: accepted.namespaceId ?? undefined,
    };
  }
  if (accepted.namespaceId) {
    return { kind: "namespace", namespaceId: accepted.namespaceId };
  }
  return { kind: "joined" };
}

export interface AudienceRow {
  audienceId: string;
  name: string;
  /** The audience's audience context. Null while an audience exists but its context has not replicated yet. */
  contextId: string | null;
  memberCount: number;
  /** True when this node already holds an identity in the audience's context. */
  joined: boolean;
  /**
   * The identity this node holds in the audience's context, or null. The audience's
   * contract keys its roster by this, so it is what marks "you" in a member
   * list.
   */
  identity: string | null;
}

/**
 * Audiences in a namespace, each with its context and whether we can enter it.
 *
 * Fans out per audience (contexts + members + our own identity) because the list API
 * returns only `{groupId, name}`. Bounded by audience count, and a per-audience failure
 * degrades that row rather than emptying the list — an audience whose context has not
 * replicated to this node yet is the normal case right after joining, not an error.
 */
export async function listAudiences(
  admin: AdminLike,
  namespaceId: string,
): Promise<AudienceRow[]> {
  const subgroups = await admin.listNamespaceGroups(namespaceId);
  return Promise.all(
    (subgroups ?? []).map(async (sg) => {
      const [contexts, members, meta] = await Promise.all([
        admin.listGroupContexts(sg.groupId).catch(() => []),
        admin
          .listGroupMembers(sg.groupId)
          .then((r) => r.members ?? [])
          .catch(() => []),
        // The listing returns a bare `{groupId}` on rc.19 — `name` is never
        // populated — so the audience's name has to come from its metadata record,
        // which is where `createAudience` writes it.
        admin.getGroupMetadata(sg.groupId).catch(() => null),
      ]);
      const contextId = contexts?.[0]?.contextId ?? null;
      const identity = contextId ? await ownedIdentity(admin, contextId) : null;
      return {
        audienceId: sg.groupId,
        name:
          (sg.name ?? "").trim() ||
          (meta?.name ?? "").trim() ||
          `Audience ${sg.groupId.slice(0, 6)}`,
        contextId,
        memberCount: members.length,
        joined: !!identity,
        identity,
      };
    }),
  );
}

/**
 * Create an audience: subgroup → OPEN visibility → its own context.
 *
 * The visibility step is not optional and not cosmetic. An audience created with
 * defaults is RESTRICTED, which means the namespace members you just invited get
 * a 403 from `join-via-inheritance` and can never reach the audience. Suite S3/S4
 * exists to pin exactly this.
 */
export async function createAudience(
  admin: AdminLike,
  opts: { applicationId: string; namespaceId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ audienceId: string; contextId: string; memberPublicKey: string }> {
  onStatus("Creating the audience…");
  // ⚠️ `groupName`, not `name`. mero-js renamed the field; the request denies
  // unknown ones, so the old spelling is a 400 rather than a silently ignored
  // key. (The value still does not persist — see the note below — but the
  // request has to be well-formed either way.)
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    groupName: opts.name,
  });

  // `createGroupInNamespace`'s `name` does NOT persist on rc.19: the subgroup
  // listing comes back as bare `{groupId}` and the group's metadata record is
  // null. Verified against a live node. So write the name where it is actually
  // readable — the metadata record, which is also where `Namespace.name` comes
  // from. Without this every audience renders as "Audience 69aab2".
  //
  onStatus("Naming the audience…");
  await admin.setGroupMetadata(sg.groupId, { name: opts.name }).catch(() => {});

  onStatus("Opening the audience to namespace members…");
  // Lowercase — core rejects "Open". NOT swallowed: unlike the namespace-root
  // call, this one is load-bearing. If it fails the audience is restricted, and a
  // restricted audience silently cannot be joined by the people invited to the
  // namespace. Better to fail here, where the message can say so.
  await admin.setSubgroupVisibility(sg.groupId, {
    subgroupVisibility: "open",
  });

  onStatus("Creating the audience context…");
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: sg.groupId, // bound to the SUBGROUP, not the namespace
    initializationParams: initParams(),
  });

  return {
    audienceId: sg.groupId,
    contextId: ctx.contextId,
    memberPublicKey: ctx.memberPublicKey,
  };
}

/**
 * Delete an audience: its context first, then the subgroup that held it.
 *
 * ⚠️ Order matters and is not interchangeable. The context is bound to the
 * subgroup, so removing the subgroup first orphans a context that no member can
 * reach and no longer appears in any listing — it keeps replicating and cannot
 * be cleaned up through the app. Context, then group.
 *
 * The context delete is NOT swallowed: if it fails, stop, because proceeding is
 * exactly how the orphan above gets made. The subgroup delete is allowed to
 * report its own failure, by which point the audience is already unreadable.
 *
 * This removes it for EVERYONE, not just this node — it is a governance op on
 * the namespace, not a local hide.
 */
export async function deleteAudience(
  admin: AdminLike,
  opts: { audienceId: string; contextId: string | null },
  onStatus: StatusFn = noop,
): Promise<void> {
  if (opts.contextId) {
    onStatus("Deleting the audience's context…");
    await admin.deleteContext(opts.contextId);
  }
  onStatus("Removing the audience…");
  await admin.deleteGroup(opts.audienceId);
}

/**
 * Delete a space, and every audience in it.
 *
 * Each audience's context is deleted first for the reason above, then the
 * namespace goes. An audience whose context this node has never seen is skipped
 * rather than failing the whole delete: it cannot be addressed from here, and
 * refusing to delete the space because one context has not replicated would
 * leave the space undeletable on exactly the node that most wants rid of it.
 */
export async function deleteSpace(
  admin: AdminLike,
  opts: { namespaceId: string },
  onStatus: StatusFn = noop,
): Promise<void> {
  onStatus("Finding the audiences in this space…");
  const audiences = await listAudiences(admin, opts.namespaceId).catch(() => []);

  for (const audience of audiences) {
    if (!audience.contextId) continue;
    onStatus(`Deleting “${audience.name}”…`);
    await admin.deleteContext(audience.contextId).catch(() => {});
  }

  onStatus("Removing the space…");
  await admin.deleteNamespace(opts.namespaceId);
}

// ── Invitations ───────────────────────────────────────────────────────────────

/**
 * Mint an OPEN namespace invitation and encode it as one pasteable code.
 *
 * OPEN means the invitation carries no invitee key, so anyone holding the code can
 * join. Deliberately do NOT pass `inviteePublicKey`: it is silently ignored and
 * misleads the next reader (learned in `dev-invite.sh`).
 */
export async function mintNamespaceInvite(
  admin: AdminLike,
  opts: { namespaceId: string; namespaceName?: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Minting a namespace invitation…");
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error("The node returned an invitation with no signature.");
  }
  onStatus("Encoding the invite code…");
  return encodeInvite({
    invitation,
    kind: "namespace",
    groupAlias: opts.namespaceName,
    groupId: opts.namespaceId,
  });
}

/**
 * Mint a code that lands someone in ONE ROOM.
 *
 * The grant is the NAMESPACE invitation, and that is not a shortcut — it is how
 * audience access works. Audience membership is INHERITED: a joiner must hold the parent
 * before an audience will admit them, and once they do, `joinSubgroupInheritance` lets
 * them into any OPEN audience in it (which is every audience this app makes, because a
 * restricted audience cannot be joined by invited members at all — finding #1).
 *
 * So an audience code is "namespace grant + open this audience", and the UI says exactly
 * that rather than implying a narrower grant than it gives. A genuinely
 * audience-scoped invitation is not expressible while audiences must be open.
 *
 * Two things were tried and are recorded here so they are not tried again:
 *
 *   - `createGroupInvitation(audienceId, {recursive: true})` — the obvious API for
 *     "invitation to the whole chain". rc.19 IGNORES `recursive` on a subgroup and
 *     returns a single invitation, so nothing carries the parent grant.
 *   - a bare subgroup invitation + `joinGroup` — useless to a stranger, who is
 *     refused for not holding the parent.
 *
 * `acceptInvite` still understands a real chain (see `parseChain`), so a future
 * node that mints one needs no change here beyond emitting it.
 */
export async function mintAudienceInvite(
  admin: AdminLike,
  opts: {
    namespaceId: string;
    audienceId: string;
    audienceName?: string;
    namespaceName?: string;
    contextId?: string | null;
  },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Minting an invitation for this audience…");
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error("The node returned an invitation with no signature.");
  }

  onStatus("Encoding the invite code…");
  return encodeInvite({
    invitation,
    kind: "audience",
    groupId: opts.namespaceId,
    // Routing hints, outside the signature and unable to grant anything: the node
    // still decides whether to admit the joiner to this audience.
    audienceId: opts.audienceId,
    contextId: opts.contextId ?? undefined,
    audienceName: opts.audienceName,
    groupAlias: opts.namespaceName,
  });
}

// ── Joining ───────────────────────────────────────────────────────────────────

export interface AcceptedInvite {
  namespaceId: string | null;
  audienceId: string | null;
  /** Carried by the code as a hint; may not have replicated to this node yet. */
  contextId: string | null;
  audienceName?: string;
  namespaceName?: string;
}

/**
 * Accept a decoded invite: walk its chain, or join the single group it names.
 *
 * The id acted on always comes from INSIDE the signed invitation, never from the
 * wrapper, so a tampered code cannot redirect a join somewhere else.
 */
export async function acceptInvite(
  admin: AdminLike,
  payload: AudienceInvitePayload,
  onStatus: StatusFn = noop,
): Promise<AcceptedInvite> {
  const result: AcceptedInvite = {
    namespaceId: null,
    // Routing hints from the code. Unsigned, so they steer navigation only —
    // whether we are actually let into this audience is the node's decision, made
    // against the membership the signed invitation just established.
    audienceId: payload.audienceId ?? null,
    contextId: payload.contextId ?? null,
    audienceName: payload.audienceName,
    namespaceName: payload.groupAlias,
  };

  // An audience code's GRANT is the namespace (see `mintAudienceInvite`), so the join step
  // is a namespace join regardless of where the code points. Only an explicit
  // chain entry describes a subgroup invitation, and only a future node mints one.
  const steps: InviteChainEntry[] = payload.chain ?? [
    {
      groupId: groupIdOfInvite(payload),
      invitation: payload.invitation,
      kind: "namespace",
    },
  ];

  for (const step of steps) {
    // Trust the signature, not the label: re-read the id from the signed blob.
    const signedId = groupIdOfInvite(step.invitation) || step.groupId;
    const label =
      step.kind === "namespace"
        ? `namespace${payload.groupAlias ? ` “${payload.groupAlias}”` : ""}`
        : `audience${payload.audienceName ? ` “${payload.audienceName}”` : ""}`;
    onStatus(`Joining the ${label}…`);
    try {
      if (step.kind === "namespace") {
        await admin.joinNamespace(signedId, {
          invitation: step.invitation as never,
        });
      } else {
        await admin.joinGroup({ invitation: step.invitation as never });
      }
    } catch (e) {
      // Walking a chain routinely re-joins something already held.
      if (!isAlreadyMember(e)) throw e;
      onStatus(`Already in the ${label} — continuing…`);
    }
    if (step.kind === "namespace") result.namespaceId = signedId;
    else result.audienceId = signedId;
  }

  // An audience invite whose chain had no namespace entry still needs one to navigate
  // to; ask the node which namespace the audience sits under.
  if (!result.namespaceId && result.audienceId) {
    result.namespaceId = await parentNamespaceOf(admin, result.audienceId);
  }
  return result;
}

/**
 * Which namespace an audience belongs to, discovered by looking for it among the
 * namespaces this node knows. There is no "parent of" read in the admin API, and
 * the invite wrapper's claim is unsigned, so this is the honest way to get it.
 */
async function parentNamespaceOf(
  admin: AdminLike,
  audienceId: string,
): Promise<string | null> {
  const namespaces = await admin.listNamespaces().catch(() => []);
  for (const ns of namespaces ?? []) {
    const audiences = await admin
      .listNamespaceGroups(ns.namespaceId)
      .catch(() => []);
    if ((audiences ?? []).some((r) => r.groupId === audienceId))
      return ns.namespaceId;
  }
  return null;
}

/** Does this node already hold a member identity in `contextId`? */
/**
 * The identity this node holds in a context, or null when it holds none.
 *
 * Returns the identity rather than a boolean because the audienceer needs both: the
 * boolean answers "can I enter", and the identity is what the audience's contract
 * roster keys its members by — without it a member list cannot tell which row
 * is you. The round trip is the same either way.
 */
async function ownedIdentity(
  admin: AdminLike,
  contextId: string,
): Promise<string | null> {
  const owned = await admin
    .getContextIdentitiesOwned(contextId)
    .catch(() => null);
  return owned?.identities?.[0] ?? null;
}

/**
 * Get into an audience's context, and return the member identity to post as.
 *
 * Three stages, because each is genuinely needed:
 *
 *   1. Already hold an identity? Done — entering an audience you are in must be instant.
 *   2. Self-admit into the OPEN subgroup (`joinSubgroupInheritance`). This is the
 *      step whose absence made audiences unreachable: joining a namespace does NOT put
 *      you in its audiences.
 *   3. Then WAIT. Auto-follow carries the context identity, but it is not instant
 *      and not guaranteed — so poll, and fall back to an explicit `joinContext`.
 *      `dev-invite.sh` and suite S4 both need this same fallback.
 */

/** A 403 from the admission check, as opposed to a network or shape failure. */
function isForbidden(e: unknown): boolean {
  return /403|forbidden|not allowed|not eligible/i.test(
    e instanceof Error ? e.message : String(e),
  );
}

/**
 * Join an audience by inheritance, retrying while the node says "not eligible".
 *
 * A 403 here is NOT proof that the audience is restricted, which is what this used
 * to assert. Inheritance is checked against the namespace membership as this
 * node has PROJECTED it, and a membership that exists is not yet a membership
 * that confers anything — on a cold join the grant arrives over gossip and is
 * projected a moment later. The redeem path joins the namespace and enters the
 * audience back to back, so it lands inside exactly that window: the user is told
 * their audience was "probably created as restricted" about an audience that is open,
 * and a retry a second later would have worked.
 *
 * So: re-ask, nudging a sync between attempts, and only report after the
 * window has genuinely passed. Verified against two live nodes — the same
 * sequence succeeds on the first attempt once the membership has projected,
 * and the open/restricted setting is unchanged throughout.
 */
async function joinAudienceWithRetry(
  admin: AdminLike,
  audienceId: string,
  onStatus: StatusFn,
): Promise<void> {
  const deadline = Date.now() + ADMISSION_TIMEOUT_MS;
  let lastError: unknown = null;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await admin.joinSubgroupInheritance(audienceId);
      return;
    } catch (e) {
      // Re-joining something already held is success, not failure.
      if (isAlreadyMember(e)) return;
      // Anything that is not an admission refusal is a real error: a bad id, a
      // shape rejection, an unreachable node. Retrying those just delays the
      // message by the length of the window.
      if (!isForbidden(e)) throw e;
      lastError = e;
      if (attempt === 1) {
        onStatus("Waiting for your membership to reach this node…");
      }
      // Nudge the namespace along rather than only sleeping: the thing being
      // waited for is a projection of state that arrives over gossip.
      await admin.syncGroup(audienceId).catch(() => {});
      await sleep(ADMISSION_POLL_MS);
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `The audience did not admit you after ${Math.round(ADMISSION_TIMEOUT_MS / 1000)}s ` +
      `(${msg}). ${await diagnoseAdmission(admin, audienceId)}`,
  );
}

/**
 * Work out WHY an audience refused us, instead of asserting a cause.
 *
 * The two candidates look identical from a 403 and want opposite responses —
 * one is "wait or rejoin the space", the other is "this audience can never admit
 * anyone invited to the space". Guessing sends people to check a setting that
 * is usually correct, so ask the node which it is.
 *
 * Best-effort by construction: this runs on a path that is already failing, so
 * every read is allowed to fail and the answer degrades to naming both
 * possibilities rather than throwing a second error over the first.
 */
async function diagnoseAdmission(
  admin: AdminLike,
  audienceId: string,
): Promise<string> {
  const visibility = await admin
    .getSubgroupVisibility(audienceId)
    .then((v) => String(v ?? "").toLowerCase())
    .catch(() => "");

  if (visibility === "restricted") {
    return (
      "The audience is RESTRICTED, so being in the space does not admit you — " +
      "whoever created it has to open it, or invite you to the audience directly."
    );
  }

  const namespaceId = await parentNamespaceOf(admin, audienceId).catch(() => null);
  if (!namespaceId) {
    return (
      "This node cannot see which space the audience belongs to, which means the " +
      "space has not replicated here yet — rejoin the space, then try again."
    );
  }

  if (visibility === "open") {
    return (
      "The audience is open, so this is your membership of the space not having " +
      "reached this node yet. Try again in a moment; if it persists, rejoin " +
      "the space from the invitation."
    );
  }

  return (
    "Could not read the audience's visibility. Either your membership of the " +
    "space has not reached this node yet, or the audience was created restricted."
  );
}

export async function enterAudienceContext(
  admin: AdminLike,
  opts: { audienceId: string; contextId: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Checking your membership…");
  const owned = await admin
    .getContextIdentitiesOwned(opts.contextId)
    .catch(() => null);
  const existing = owned?.identities?.[0];
  if (existing) return existing;

  onStatus("Joining the audience…");
  await joinAudienceWithRetry(admin, opts.audienceId, onStatus);

  onStatus("Waiting for your identity in the audience…");
  const deadline = Date.now() + IDENTITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const again = await admin
      .getContextIdentitiesOwned(opts.contextId)
      .catch(() => null);
    const id = again?.identities?.[0];
    if (id) return id;
    await sleep(IDENTITY_POLL_MS);
  }

  // Auto-follow did not carry it. Ask for the context explicitly — the same
  // fallback dev-invite.sh needs, because auto-follow is not a guarantee.
  onStatus("Joining the audience context directly…");
  const joined = await admin.joinContext(opts.contextId);
  const identity = joined?.memberPublicKey;
  if (!identity) {
    throw new Error(
      "Joined the audience but no member identity arrived — the context may not have replicated to this node yet.",
    );
  }
  return identity;
}
