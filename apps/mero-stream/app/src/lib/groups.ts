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

import type { MeroJs } from "@calimero-network/mero-js";
import {
  encodeInvite,
  groupIdOfInvite,
  type InviteChainEntry,
  type SignedInvitation,
  type StreamInvitePayload,
} from "./inviteCodec";

/** The admin client, as `useMero().mero.admin` provides it. */
export type AdminLike = MeroJs["admin"];

/**
 * Progress sink. Every flow in here is several round-trips deep, and a single
 * "Working…" for six seconds of network is the difference between "loading" and
 * "broken" from the user's side — so each step names itself.
 */
export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** All base capabilities. Members who cannot post chunks are of no use here. */
const ALL_BASE_CAPABILITIES = 15;

/** How long to wait for a joined context's identity to land, and how often to look. */
const IDENTITY_TIMEOUT_MS = 60_000;
const IDENTITY_POLL_MS = 1_500;

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
  admin: AdminLike,
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
export async function createStreamNamespace(
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
  // Non-fatal: the creator already holds full caps, so a failure here costs
  // invitees their permissions rather than breaking the namespace.
  await admin
    .setDefaultCapabilities(ns.namespaceId, {
      defaultCapabilities: ALL_BASE_CAPABILITIES,
    })
    .catch(() => {});

  onStatus("Opening the namespace to invited members…");
  await admin
    .setSubgroupVisibility(ns.namespaceId, { subgroupVisibility: "open" })
    .catch(() => {});

  return { namespaceId: ns.namespaceId };
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
  | { kind: "room"; contextId: string; identity: string; roomName?: string }
  | { kind: "namespace"; namespaceId: string }
  | { kind: "joined" };

/**
 * Accept an invitation and enter whatever it granted.
 *
 * Extracted so the paste path and the link path cannot drift: they used to be one
 * inline sequence in StreamsPage, which meant the app-wide invitation prompt
 * either had to duplicate it or could not exist. A room invitation needs BOTH
 * joins — the namespace grant and then the room's context — and forgetting the
 * second leaves someone a member of a stream staring at a call they cannot enter.
 */
export async function redeemInvite(
  admin: AdminLike,
  payload: StreamInvitePayload,
  onStatus: (message: string) => void,
): Promise<Redeemed> {
  const accepted = await acceptInvite(admin, payload, onStatus);

  if (accepted.roomId && accepted.contextId) {
    const identity = await enterRoomContext(
      admin,
      { roomId: accepted.roomId, contextId: accepted.contextId },
      onStatus,
    );
    return {
      kind: "room",
      contextId: accepted.contextId,
      identity,
      roomName: accepted.roomName,
    };
  }
  if (accepted.namespaceId) {
    return { kind: "namespace", namespaceId: accepted.namespaceId };
  }
  return { kind: "joined" };
}

export interface RoomRow {
  roomId: string;
  name: string;
  /** The room's call context. Null while a room exists but its context has not replicated yet. */
  contextId: string | null;
  memberCount: number;
  /** True when this node already holds an identity in the room's context. */
  joined: boolean;
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
  admin: AdminLike,
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
      const joined = contextId ? await holdsIdentity(admin, contextId) : false;
      return {
        roomId: sg.groupId,
        name:
          (sg.name ?? "").trim() ||
          (meta?.name ?? "").trim() ||
          `Room ${sg.groupId.slice(0, 6)}`,
        contextId,
        memberCount: members.length,
        joined,
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
  admin: AdminLike,
  opts: { applicationId: string; namespaceId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ roomId: string; contextId: string; memberPublicKey: string }> {
  onStatus("Creating the room…");
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    name: opts.name,
  });

  // `createGroupInNamespace`'s `name` does NOT persist on rc.19: the subgroup
  // listing comes back as bare `{groupId}` and the group's metadata record is
  // null. Verified against a live node. So write the name where it is actually
  // readable — the metadata record, which is also where `Namespace.name` comes
  // from. Without this every room renders as "Room 69aab2".
  //
  // Non-fatal: a nameless room still works, and losing the label is not worth
  // failing a created room over.
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

  return {
    roomId: sg.groupId,
    contextId: ctx.contextId,
    memberPublicKey: ctx.memberPublicKey,
  };
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
  admin: AdminLike,
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
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
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
  admin: AdminLike,
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
        await admin.joinGroup({ invitation: step.invitation as never });
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
 * Which namespace a room belongs to, discovered by looking for it among the
 * namespaces this node knows. There is no "parent of" read in the admin API, and
 * the invite wrapper's claim is unsigned, so this is the honest way to get it.
 */
async function parentNamespaceOf(
  admin: AdminLike,
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
async function holdsIdentity(
  admin: AdminLike,
  contextId: string,
): Promise<boolean> {
  const owned = await admin
    .getContextIdentitiesOwned(contextId)
    .catch(() => null);
  return !!owned?.identities?.length;
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
export async function enterRoomContext(
  admin: AdminLike,
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
  try {
    await admin.joinSubgroupInheritance(opts.roomId);
  } catch (e) {
    if (!isAlreadyMember(e)) {
      // A restricted room is the one failure worth naming precisely: the generic
      // 403 gives no hint that visibility is the cause, and it is the single most
      // likely reason a room cannot be entered.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        /403|forbidden|not allowed/i.test(msg)
          ? `The room did not admit you (${msg}). It was probably created as restricted rather than open.`
          : msg,
      );
    }
  }

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
