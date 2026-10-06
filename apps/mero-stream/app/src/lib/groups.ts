// ── Namespaces, rooms, invitations ────────────────────────────────────────────
//
// The model, with the vocabulary kept straight deliberately: a "group" is a
// SUBGROUP inside a namespace, never the namespace itself.
//
//   Namespace  = the stream / workspace        ← invite people here
//     └── Subgroup ("room") + Context          ← one video call
//     └── Subgroup ("room") + Context
//
// Every step here is proven by `app/e2e/two-node-suite.mjs` over raw HTTP; this
// module is the same sequence through mero-js, so the UI does what the suite
// asserts rather than an approximation of it. Two findings from that suite are
// encoded below and are the whole reason rooms work at all:
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

import { CAPABILITIES, type AdminApiClient } from "@calimero-network/mero-js";
import {
  encodeInvite,
  groupIdOfInvite,
  type InviteChainEntry,
  type SignedInvitation,
  type StreamInvitePayload,
} from "./inviteCodec";
import { markNamespaceJustJoined } from "@calimero-apps/join-sync";
import {
  describeInviteFailure,
  redeemInvitation,
  type RedeemOutcome,
} from "@calimero-apps/invite";
import {
  HOSTING_REFUSED_MESSAGE,
  clearStreamUnhosted,
  markStreamUnhosted,
} from "./hosting";

// Every function here takes `admin: AdminApiClient` — the SESSION-AWARE admin
// from `useMero().admin`, never `useMero().mero.admin`. On a node login the two
// are the same object. On an account (delegated) session they are not: the raw
// client's admin is the relay's node route, which an account's token cannot
// pass — `POST /admin-api/namespaces`, `/contexts`, `/namespaces/:id/join` all
// answer 403 and `identities-owned` comes back empty, so every flow below sat
// on "Working…" forever. `useMero().admin` is the account admin: the same
// method names, with writes carried as governance ops, delegated creation and
// self-signed invitations. Taking the type from mero-js rather than
// `MeroJs["admin"]` is what keeps the raw client out of this module by
// construction.
//
// One method the account admin does NOT have is `joinGroup` (a targeted
// subgroup invitation is a node's own join). This app never needs it: rooms are
// OPEN subgroups entered by inheritance, which the account admin carries as
// MemberJoinedOpen. `acceptInvite` falls back to exactly that when a chain
// names a room — see there.

/**
 * Progress sink. Every flow in here is several round-trips deep, and a single
 * "Working…" for six seconds of network is the difference between "loading" and
 * "broken" from the user's side — so each step names itself.
 */
export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/**
 * What an invited MEMBER may do.
 *
 * ── Why this is not 15 ───────────────────────────────────────────────────────
 *
 * It was, with the comment "members who cannot post chunks are of no use here".
 * That reasoning was about participation, and it is right — but the number does
 * not say it. Two things are wrong with `15`, pulling in opposite directions:
 *
 *   1. **It includes MANAGE_MEMBERS (1 << 3).** So everyone invited could
 *      change anyone's role, including demoting whoever invited them. There was
 *      no role system, only the appearance of one.
 *
 *   2. **It omits the bits `createRoom` needs** — CAN_CREATE_SUBGROUP (1 << 5),
 *      CAN_MANAGE_VISIBILITY (1 << 7), CAN_MANAGE_METADATA (1 << 8). A
 *      namespace OWNER holds full capabilities independently of this default,
 *      so that only ever failed for other people: making a room worked for
 *      whoever created the space and was refused for everyone they invited. The
 *      hard half to notice, because the person who would report it is not the
 *      person testing it.
 *
 * So the old default over-granted governance and under-granted participation at
 * once. The bits below are derived from this module's own call sites:
 *
 *   createRoom()    →  createGroupInNamespace    CAN_CREATE_SUBGROUP
 *                      setGroupMetadata          CAN_MANAGE_METADATA
 *                      setSubgroupVisibility     CAN_MANAGE_VISIBILITY
 *                      createContext             CAN_CREATE_CONTEXT
 *   mint*Invite()   →  createNamespaceInvitation CAN_INVITE_MEMBERS
 *   enterRoom*()    →  joinSubgroupInheritance   CAN_JOIN_OPEN_SUBGROUPS
 *   (admin only)    →  updateMemberRole          MANAGE_MEMBERS
 *
 * A member gets everything except the last: join, publish, start a room, invite
 * people. What they cannot do is change who governs the space.
 *
 * ⚠️ Withheld from both roles: CAN_AUTHOR_ON_BEHALF (1 << 9), which lets a node
 * publish writes attributed to another member, and MANAGE_APPLICATION (1 << 4).
 * No call site needs either.
 */
export const MEMBER_CAPABILITIES =
  CAPABILITIES.CAN_CREATE_CONTEXT |
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_MANAGE_METADATA;

/** A member, plus the one bit that governs the namespace. */
export const ADMIN_CAPABILITIES =
  MEMBER_CAPABILITIES | CAPABILITIES.MANAGE_MEMBERS;

/** How long to wait for a joined context's identity to land, and how often to look. */
const IDENTITY_TIMEOUT_MS = 60_000;
const IDENTITY_POLL_MS = 1_500;

/** How long to keep asking a room to admit us while the grant projects. */
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
function initParamsFor(name: string): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify({ name })));
}

/**
 * A join that is already satisfied is a SUCCESS, not a failure. Re-pasting a code,
 * a retry after a timeout, and walking a recursive chain that overlaps memberships
 * you already have all land here — and every one of them should end with the user
 * in the room rather than staring at "already a member" styled as an error.
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
  roomCount: number;
}

export async function listStreamNamespaces(
  admin: AdminApiClient,
  applicationId: string,
): Promise<NamespaceRow[]> {
  const namespaces = await admin.listNamespacesForApplication(applicationId);
  return (namespaces ?? []).map((n) => ({
    namespaceId: n.namespaceId,
    name: (n.name ?? "").trim() || `Stream ${n.namespaceId.slice(0, 6)}`,
    memberCount: n.memberCount ?? 0,
    // `subgroupCount` is the room count. Prefer it over listing every namespace's
    // groups: that would be one request per row just to render a number.
    roomCount: n.subgroupCount ?? 0,
  }));
}

/**
 * Create the namespace that holds a stream's rooms.
 *
 * No context is created here — that is a room's job. A namespace with no room is
 * a valid, expected state: you invite people to the namespace, then make rooms.
 */
export interface CreatedStream {
  namespaceId: string;
  /**
   * Whether somebody will be able to CLAIM an invitation to this stream.
   *
   * On a node login this is always true: the node that founded the namespace
   * hosts it, and it admits whoever redeems the code. On an account session the
   * namespace is founded through a relay and the cloud is asked to host it
   * (HA) right after; `haEnabled: false` means the cloud refused — most often
   * because the account is not linked to a cloud user yet — and the namespace
   * exists but an invitee with no node has no relay to be admitted through.
   * Minting an invitation would then fail with "not hosted" at invite time, on
   * a different page, with no hint of what to do. So the refusal is returned
   * here and remembered (`lib/hosting`), and the room page says so on arrival.
   */
  haEnabled: boolean;
  /** Why `haEnabled` is false, in words a person can act on. */
  haError?: string;
}

export async function createStreamNamespace(
  admin: AdminApiClient,
  opts: { applicationId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<CreatedStream> {
  onStatus("Creating the namespace…");
  const ns = (await admin.createNamespace({
    applicationId: opts.applicationId,
    name: opts.name,
  })) as { namespaceId: string; haEnabled?: boolean; haError?: string };

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

  // A node's response has no `haEnabled`: the node hosts what it founds. Only
  // the account admin reports hosting, and only it can be refused it.
  const haEnabled = ns.haEnabled ?? true;
  if (!haEnabled) {
    const reason = ns.haError ?? HOSTING_REFUSED_MESSAGE;
    markStreamUnhosted(ns.namespaceId, reason);
    return { namespaceId: ns.namespaceId, haEnabled, haError: reason };
  }
  clearStreamUnhosted(ns.namespaceId);
  return { namespaceId: ns.namespaceId, haEnabled };
}

// ── Rooms (subgroups) ─────────────────────────────────────────────────────────

/**
 * Where a redeemed invitation should land the user.
 *
 * Returned rather than navigated to, because the two callers that redeem — the
 * paste field and the link prompt — live in different parts of the tree and only
 * the caller knows how it wants to route.
 */
export type Redeemed =
  | {
      kind: "room";
      contextId: string;
      identity: string;
      roomName?: string;
      /**
       * The stream this room belongs to, when the invitation named it. Carried
       * so the call can offer a way back to the room list: a context knows
       * nothing about its namespace, and the admin API has no "parent of" read.
       */
      namespaceId?: string;
    }
  | { kind: "namespace"; namespaceId: string }
  | { kind: "joined" };

/**
 * What redeeming an invitation came to: the join's outcome and, when the join
 * held, where it landed. A failed join is returned rather than thrown, because
 * the caller acks or keeps the invitation by it (`shouldRetain`).
 */
export type RedeemResult =
  | {
      outcome: Extract<RedeemOutcome, { status: "failed" }>;
      landed?: undefined;
    }
  | {
      outcome: Exclude<RedeemOutcome, { status: "failed" }>;
      landed: Redeemed;
    };

/** What to tell the user about a failed join, in this app's noun. */
export function redeemFailureMessage(
  outcome: Extract<RedeemOutcome, { status: "failed" }>,
): string {
  return describeInviteFailure(outcome.reason, "stream") ?? outcome.message;
}

/** The namespace an invitation grants: the same signed id `acceptInvite` joins. */
function invitedNamespaceOf(payload: StreamInvitePayload): string {
  const step = payload.chain?.find((s) => s.kind === "namespace");
  if (step) return groupIdOfInvite(step.invitation) || step.groupId;
  return groupIdOfInvite(payload);
}

/**
 * Accept an invitation and enter whatever it granted.
 *
 * Extracted so the paste path and the link path cannot drift: they used to be one
 * inline sequence in StreamsPage, which meant the app-wide invitation prompt
 * either had to duplicate it or could not exist. A room invitation needs BOTH
 * joins — the namespace grant and then the room's context — and forgetting the
 * second leaves someone a member of a stream staring at a call they cannot enter.
 *
 * The join goes through `redeemInvitation`, which sends it once and settles a
 * failed request against the node's namespace list: the desktop proxy aborts at
 * 30s while a join can take far longer and land anyway, and that is a member,
 * not a failure.
 */
export async function redeemInvite(
  admin: AdminApiClient,
  payload: StreamInvitePayload,
  onStatus: (message: string) => void,
): Promise<RedeemResult> {
  // Written from inside `join`; the cast keeps TS from narrowing it to `null`.
  let joined = null as AcceptedInvite | null;
  const outcome = await redeemInvitation(
    {
      namespaceId: invitedNamespaceOf(payload),
      invitation: payload.invitation,
    },
    {
      join: async () => {
        joined = await acceptInvite(admin, payload, onStatus);
      },
      memberships: async () =>
        ((await admin.listNamespaces()) ?? []).map((n) => n.namespaceId),
    },
  );
  if (outcome.status === "failed") return { outcome };

  // `already-member` after a request that failed: the node lists the namespace,
  // so route by the code's hints exactly as a clean join of it would.
  const accepted: AcceptedInvite = joined ?? {
    namespaceId: outcome.namespaceId,
    roomId: payload.roomId ?? null,
    contextId: payload.contextId ?? null,
    roomName: payload.roomName,
    namespaceName: payload.groupAlias,
  };

  // The grant has landed; the namespace's own state has not. Flag it so the
  // list this joiner is about to see says "syncing" rather than rendering an
  // empty view that is indistinguishable from an empty streams.
  if (accepted.namespaceId) markNamespaceJustJoined(accepted.namespaceId);

  if (accepted.roomId && accepted.contextId) {
    const identity = await enterRoomContext(
      admin,
      { roomId: accepted.roomId, contextId: accepted.contextId },
      onStatus,
    );
    return {
      outcome,
      landed: {
        kind: "room",
        contextId: accepted.contextId,
        identity,
        roomName: accepted.roomName,
        namespaceId: accepted.namespaceId ?? undefined,
      },
    };
  }
  if (accepted.namespaceId) {
    return {
      outcome,
      landed: { kind: "namespace", namespaceId: accepted.namespaceId },
    };
  }
  return { outcome, landed: { kind: "joined" } };
}

export interface RoomRow {
  roomId: string;
  name: string;
  /** The room's call context. Null while a room exists but its context has not replicated yet. */
  contextId: string | null;
  memberCount: number;
  /** True when this node already holds an identity in the room's context. */
  joined: boolean;
  /**
   * The identity this node holds in the room's context, or null. The room's
   * contract keys its roster by this, so it is what marks "you" in a member
   * list.
   */
  identity: string | null;
}

/**
 * Rooms in a namespace, each with its context and whether we can enter it.
 *
 * Fans out per room (contexts + members + our own identity) because the list API
 * returns only `{groupId, name}`. Bounded by room count, and a per-room failure
 * degrades that row rather than emptying the list — a room whose context has not
 * replicated to this node yet is the normal case right after joining, not an error.
 */
export async function listRooms(
  admin: AdminApiClient,
  namespaceId: string,
): Promise<RoomRow[]> {
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
        // populated — so the room's name has to come from its metadata record,
        // which is where `createRoom` writes it.
        admin.getGroupMetadata(sg.groupId).catch(() => null),
      ]);
      const contextId = contexts?.[0]?.contextId ?? null;
      const identity = contextId ? await ownedIdentity(admin, contextId) : null;
      return {
        roomId: sg.groupId,
        name:
          (sg.name ?? "").trim() ||
          (meta?.name ?? "").trim() ||
          `Room ${sg.groupId.slice(0, 6)}`,
        contextId,
        memberCount: members.length,
        joined: !!identity,
        identity,
      };
    }),
  );
}

/**
 * Create a room: subgroup → OPEN visibility → its own context.
 *
 * The visibility step is not optional and not cosmetic. A room created with
 * defaults is RESTRICTED, which means the namespace members you just invited get
 * a 403 from `join-via-inheritance` and can never reach the call. Suite S3/S4
 * exists to pin exactly this.
 */
export async function createRoom(
  admin: AdminApiClient,
  opts: { applicationId: string; namespaceId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ roomId: string; contextId: string; identity: string }> {
  onStatus("Creating the room…");
  // ⚠️ `groupName`, not `name`. mero-js renamed the field; the request denies
  // unknown ones, so the old spelling is a 400 rather than a silently ignored
  // key. (The value still does not persist — see the note below — but the
  // request has to be well-formed either way.)
  // Born Open, not flipped to it: created Restricted, core admits the TEE with
  // an op sealed under the subgroup's own key, and the later Open flip cites
  // it - a namespace member outside the subgroup can read the flip but never
  // that ancestry, so their node stops applying the namespace's governance.
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    groupName: opts.name,
    visibility: "open",
  });

  // `createGroupInNamespace`'s `name` does NOT persist on rc.19: the subgroup
  // listing comes back as bare `{groupId}` and the group's metadata record is
  // null. Verified against a live node. So write the name where it is actually
  // readable — the metadata record, which is also where `Namespace.name` comes
  // from. Without this every room renders as "Room 69aab2".
  //
  onStatus("Naming the room…");
  await admin.setGroupMetadata(sg.groupId, { name: opts.name }).catch(() => {});

  onStatus("Opening the room to namespace members…");
  // Lowercase — core rejects "Open". NOT swallowed: unlike the namespace-root
  // call, this one is load-bearing. If it fails the room is restricted, and a
  // restricted room silently cannot be joined by the people invited to the
  // namespace. Better to fail here, where the message can say so.
  await admin.setSubgroupVisibility(sg.groupId, {
    subgroupVisibility: "open",
  });

  onStatus("Creating the call context…");
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: sg.groupId, // bound to the SUBGROUP, not the namespace
    initializationParams: initParamsFor(opts.name),
  });

  // The identity to execute as. NOT `ctx.memberPublicKey` on its own: the
  // account admin returns "" there (a delegated create has no node-held key to
  // report), and an empty executor makes every write in the room fail. Ask what
  // identity this session holds in the context — the same read the enter path
  // trusts — and only fall back to the create response when that is empty.
  onStatus("Reading your identity in the room…");
  const identity =
    (await ownedIdentity(admin, ctx.contextId)) || ctx.memberPublicKey || "";
  if (!identity) {
    throw new Error(
      "The room was created but no member identity came back for you — refresh and open it from the list.",
    );
  }

  return {
    roomId: sg.groupId,
    contextId: ctx.contextId,
    identity,
  };
}

// ── Invitations ───────────────────────────────────────────────────────────────

/**
 * Ask the session's admin for a namespace invitation, and turn "nobody can
 * claim this" into an instruction.
 *
 * A node mints one unconditionally. The account admin first asks the cloud who
 * hosts the namespace, and refuses with `InvitationNotClaimableError`
 * (`reason: "not-hosted"`) when the answer is nobody — the namespace was
 * founded by an account the cloud cannot place, so an invitee with no node has
 * no relay to be admitted through. That is the same refusal
 * `createStreamNamespace` already reported as `haError`; it is remembered here
 * too, so a stream joined on another device, or one created before this check
 * existed, gates its Invite buttons the moment the refusal is seen rather than
 * failing on every click.
 *
 * Matched by name and `reason`, not `instanceof`: the class lives in mero-react,
 * and this module deliberately depends on mero-js only.
 */
async function mintNamespaceInvitation(
  admin: AdminApiClient,
  namespaceId: string,
): Promise<unknown> {
  try {
    const res = await admin.createNamespaceInvitation(namespaceId, {});
    clearStreamUnhosted(namespaceId);
    return res;
  } catch (e) {
    const err = e as { name?: string; reason?: string; message?: string };
    if (err?.name === "InvitationNotClaimableError") {
      const reason =
        err.reason === "not-hosted"
          ? HOSTING_REFUSED_MESSAGE
          : (err.message ?? HOSTING_REFUSED_MESSAGE);
      markStreamUnhosted(namespaceId, reason);
      throw new Error(reason);
    }
    throw e;
  }
}

/**
 * Mint an OPEN namespace invitation and encode it as one pasteable code.
 *
 * OPEN means the invitation carries no invitee key, so anyone holding the code can
 * join. Deliberately do NOT pass `inviteePublicKey`: it is silently ignored and
 * misleads the next reader (learned in `dev-invite.sh`).
 */
export async function mintNamespaceInvite(
  admin: AdminApiClient,
  opts: { namespaceId: string; namespaceName?: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Minting a namespace invitation…");
  const res = await mintNamespaceInvitation(admin, opts.namespaceId);
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
 * room access works. Room membership is INHERITED: a joiner must hold the parent
 * before a room will admit them, and once they do, `joinSubgroupInheritance` lets
 * them into any OPEN room in it (which is every room this app makes, because a
 * restricted room cannot be joined by invited members at all — finding #1).
 *
 * So a room code is "namespace grant + open this room", and the UI says exactly
 * that rather than implying a narrower grant than it gives. A genuinely
 * room-scoped invitation is not expressible while rooms must be open.
 *
 * Two things were tried and are recorded here so they are not tried again:
 *
 *   - `createGroupInvitation(roomId, {recursive: true})` — the obvious API for
 *     "invitation to the whole chain". rc.19 IGNORES `recursive` on a subgroup and
 *     returns a single invitation, so nothing carries the parent grant.
 *   - a bare subgroup invitation + `joinGroup` — useless to a stranger, who is
 *     refused for not holding the parent.
 *
 * `acceptInvite` still understands a real chain (see `parseChain`), so a future
 * node that mints one needs no change here beyond emitting it.
 */
export async function mintRoomInvite(
  admin: AdminApiClient,
  opts: {
    namespaceId: string;
    roomId: string;
    roomName?: string;
    namespaceName?: string;
    contextId?: string | null;
  },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Minting an invitation for this room…");
  const res = await mintNamespaceInvitation(admin, opts.namespaceId);
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error("The node returned an invitation with no signature.");
  }

  onStatus("Encoding the invite code…");
  return encodeInvite({
    invitation,
    kind: "room",
    groupId: opts.namespaceId,
    // Routing hints, outside the signature and unable to grant anything: the node
    // still decides whether to admit the joiner to this room.
    roomId: opts.roomId,
    contextId: opts.contextId ?? undefined,
    roomName: opts.roomName,
    groupAlias: opts.namespaceName,
  });
}

// ── Joining ───────────────────────────────────────────────────────────────────

export interface AcceptedInvite {
  namespaceId: string | null;
  roomId: string | null;
  /** Carried by the code as a hint; may not have replicated to this node yet. */
  contextId: string | null;
  roomName?: string;
  namespaceName?: string;
}

/**
 * Accept a decoded invite: walk its chain, or join the single group it names.
 *
 * The id acted on always comes from INSIDE the signed invitation, never from the
 * wrapper, so a tampered code cannot redirect a join somewhere else.
 */
export async function acceptInvite(
  admin: AdminApiClient,
  payload: StreamInvitePayload,
  onStatus: StatusFn = noop,
): Promise<AcceptedInvite> {
  const result: AcceptedInvite = {
    namespaceId: null,
    // Routing hints from the code. Unsigned, so they steer navigation only —
    // whether we are actually let into this room is the node's decision, made
    // against the membership the signed invitation just established.
    roomId: payload.roomId ?? null,
    contextId: payload.contextId ?? null,
    roomName: payload.roomName,
    namespaceName: payload.groupAlias,
  };

  // A room code's GRANT is the namespace (see `mintRoomInvite`), so the join step
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
        : `room${payload.roomName ? ` “${payload.roomName}”` : ""}`;
    onStatus(`Joining the ${label}…`);
    try {
      if (step.kind === "namespace") {
        await admin.joinNamespace(signedId, {
          invitation: step.invitation as never,
        });
      } else {
        await joinRoomStep(admin, signedId, step);
      }
    } catch (e) {
      // Walking a chain routinely re-joins something already held.
      if (!isAlreadyMember(e)) throw e;
      onStatus(`Already in the ${label} — continuing…`);
    }
    if (step.kind === "namespace") result.namespaceId = signedId;
    else result.roomId = signedId;
  }

  // A room invite whose chain had no namespace entry still needs one to navigate
  // to; ask the node which namespace the room sits under.
  if (!result.namespaceId && result.roomId) {
    result.namespaceId = await parentNamespaceOf(admin, result.roomId);
  }
  return result;
}

/**
 * Join the ROOM entry of an invitation chain.
 *
 * A node redeems the subgroup's own signed invitation with `joinGroup`. The
 * account admin has no `joinGroup` — a targeted subgroup invitation is a node's
 * own join, and it throws `NotForAccountError` — but every room this app makes
 * is OPEN, and an open subgroup is entered by inheritance from the namespace
 * the chain has just joined. So an account takes that door instead. What an
 * account cannot do is use a targeted invitation to enter a RESTRICTED room;
 * the inheritance join then refuses, and `enterRoomContext` says why.
 */
async function joinRoomStep(
  admin: AdminApiClient,
  roomId: string,
  step: InviteChainEntry,
): Promise<void> {
  try {
    await admin.joinGroup({ invitation: step.invitation as never });
  } catch (e) {
    if ((e as { name?: string })?.name !== "NotForAccountError") throw e;
    await admin.joinSubgroupInheritance(roomId);
  }
}

/**
 * Which namespace a room belongs to, discovered by looking for it among the
 * namespaces this node knows. There is no "parent of" read in the admin API, and
 * the invite wrapper's claim is unsigned, so this is the honest way to get it.
 */
async function parentNamespaceOf(
  admin: AdminApiClient,
  roomId: string,
): Promise<string | null> {
  const namespaces = await admin.listNamespaces().catch(() => []);
  for (const ns of namespaces ?? []) {
    const rooms = await admin
      .listNamespaceGroups(ns.namespaceId)
      .catch(() => []);
    if ((rooms ?? []).some((r) => r.groupId === roomId)) return ns.namespaceId;
  }
  return null;
}

/** Does this node already hold a member identity in `contextId`? */
/**
 * The identity this node holds in a context, or null when it holds none.
 *
 * Returns the identity rather than a boolean because the caller needs both: the
 * boolean answers "can I enter", and the identity is what the room's contract
 * roster keys its members by — without it a member list cannot tell which row
 * is you. The round trip is the same either way.
 */
async function ownedIdentity(
  admin: AdminApiClient,
  contextId: string,
): Promise<string | null> {
  const owned = await admin
    .getContextIdentitiesOwned(contextId)
    .catch(() => null);
  return owned?.identities?.[0] ?? null;
}

/**
 * Get into a room's call context, and return the member identity to stream as.
 *
 * Three stages, because each is genuinely needed:
 *
 *   1. Already hold an identity? Done — entering a room you are in must be instant.
 *   2. Self-admit into the OPEN subgroup (`joinSubgroupInheritance`). This is the
 *      step whose absence made rooms unreachable: joining a namespace does NOT put
 *      you in its rooms.
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
 * Join a room by inheritance, retrying while the node says "not eligible".
 *
 * A 403 here is NOT proof that the room is restricted, which is what this used
 * to assert. Inheritance is checked against the namespace membership as this
 * node has PROJECTED it, and a membership that exists is not yet a membership
 * that confers anything — on a cold join the grant arrives over gossip and is
 * projected a moment later. The redeem path joins the namespace and enters the
 * room back to back, so it lands inside exactly that window: the user is told
 * their room was "probably created as restricted" about a room that is open,
 * and a retry a second later would have worked.
 *
 * So: re-ask, nudging a sync between attempts, and only report after the
 * window has genuinely passed. Verified against two live nodes — the same
 * sequence succeeds on the first attempt once the membership has projected,
 * and the open/restricted setting is unchanged throughout.
 */
async function joinRoomWithRetry(
  admin: AdminApiClient,
  roomId: string,
  onStatus: StatusFn,
): Promise<void> {
  const deadline = Date.now() + ADMISSION_TIMEOUT_MS;
  let lastError: unknown = null;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await admin.joinSubgroupInheritance(roomId);
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
      await admin.syncGroup(roomId).catch(() => {});
      await sleep(ADMISSION_POLL_MS);
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `The room did not admit you after ${Math.round(ADMISSION_TIMEOUT_MS / 1000)}s ` +
      `(${msg}). ${await diagnoseAdmission(admin, roomId)}`,
  );
}

/**
 * Work out WHY a room refused us, instead of asserting a cause.
 *
 * The two candidates look identical from a 403 and want opposite responses —
 * one is "wait or rejoin the stream", the other is "this room can never admit
 * anyone invited to the stream". Guessing sends people to check a setting that
 * is usually correct, so ask the node which it is.
 *
 * Best-effort by construction: this runs on a path that is already failing, so
 * every read is allowed to fail and the answer degrades to naming both
 * possibilities rather than throwing a second error over the first.
 */
async function diagnoseAdmission(
  admin: AdminApiClient,
  roomId: string,
): Promise<string> {
  const visibility = await admin
    .getSubgroupVisibility(roomId)
    .then((v) => String(v ?? "").toLowerCase())
    .catch(() => "");

  if (visibility === "restricted") {
    return (
      "The room is RESTRICTED, so being in the stream does not admit you — " +
      "whoever created it has to open it, or invite you to the room directly."
    );
  }

  const namespaceId = await parentNamespaceOf(admin, roomId).catch(() => null);
  if (!namespaceId) {
    return (
      "This node cannot see which stream the room belongs to, which means the " +
      "stream has not replicated here yet — rejoin the stream, then try again."
    );
  }

  if (visibility === "open") {
    return (
      "The room is open, so this is your membership of the stream not having " +
      "reached this node yet. Try again in a moment; if it persists, rejoin " +
      "the stream from the invitation."
    );
  }

  return (
    "Could not read the room's visibility. Either your membership of the " +
    "stream has not reached this node yet, or the room was created restricted."
  );
}

export async function enterRoomContext(
  admin: AdminApiClient,
  opts: { roomId: string; contextId: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus("Checking your membership…");
  const owned = await admin
    .getContextIdentitiesOwned(opts.contextId)
    .catch(() => null);
  const existing = owned?.identities?.[0];
  if (existing) return existing;

  onStatus("Joining the room…");
  await joinRoomWithRetry(admin, opts.roomId, onStatus);

  onStatus("Waiting for your identity in the call…");
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
  onStatus("Joining the call context directly…");
  const joined = await admin.joinContext(opts.contextId);
  const identity = joined?.memberPublicKey;
  if (!identity) {
    throw new Error(
      "Joined the room but no member identity arrived — the context may not have replicated to this node yet.",
    );
  }
  return identity;
}
