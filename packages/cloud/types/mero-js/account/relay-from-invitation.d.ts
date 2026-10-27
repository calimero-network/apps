/**
 * Resolving a relay from an INVITATION rather than from an account.
 *
 * # The gap this closes
 *
 * `ConnectButtonAccount` finds a relay by asking the cloud what serves the
 * *account* (`CloudClient.getAccountRelays`). A freshly enrolled account is a
 * member of nothing, so that read correctly answers `[]` and the button
 * correctly refuses to connect: there is nowhere to write, and a typed guess
 * would be a node that refuses every warrant.
 *
 * But a newcomer is not stuck — they are holding an invitation, and an
 * invitation names a namespace. `CloudClient.getNamespaceRouting` answers which
 * nodes serve *that namespace*, and it is deliberately anonymous: a joiner has
 * no cloud session, and needing one is exactly what this path exists to avoid.
 * So the bootstrap order is namespace first, account second — admission is what
 * makes `getAccountRelays` answer at all, not the other way round.
 *
 * # Two sources, one intersection, and why it must not be skipped
 *
 * The invitation's `admitters` list sits INSIDE the body the group admin
 * signed, so it is authorization: merod answers `403` to an `/admit` from a node
 * that list does not name, whatever else is true of it. The cloud's list is
 * every node currently assigned to the namespace — it cannot know which
 * invitation the caller holds, so it cannot filter by the signed list, and a
 * node assigned *after* the invitation was minted looks perfect in every field
 * the cloud reports and still refuses the claim.
 *
 * Intersecting here is therefore not belt-and-braces: it is the check that
 * turns an unexplainable `403` into "your invitation names none of these nodes,
 * ask for a fresh one". It is never relaxed to make a flow work.
 *
 * # `servable` and `canAdmit` are advisory; `writable` is information
 *
 * `servable` and `canAdmit` are derived from assignment heartbeats, and a lapsed
 * heartbeat is not the same fact as a node that will refuse. Measured against
 * prod: the cloud reported `servable: false, canAdmit: false, fresh: false` for a
 * node whose `/admin-api/health` answered `{"status":"alive"}` and which had just
 * minted the invitation being claimed. Gating on them meant refusing to knock on
 * an open door, so a node with an address is tried and the NODE decides —
 * `admit_join` re-verifies the invitation, the signature and the admitters list,
 * so asking loosens nothing and a refusal names its own cause. `stale` on the
 * result says the attempt rests on advisory data.
 *
 * `writable` — and its per-node form, `canExecute` — is about `CAN_AUTHOR_ON_BEHALF`,
 * which admission does **not** require: relaying a join the joiner signed is not
 * authoring on anyone's behalf. So a non-writable namespace is not a refusal
 * here; it is reported on the result, because it is precisely why the writes
 * would fail *after* connecting, and a caller that cannot tell the two apart
 * sends the user to the wrong place.
 */
import { CloudClient } from '../cloud/index.js';
/**
 * Which step could not be completed. Each one needs a different action from the
 * person, which is why this is an enum and not a message.
 *
 * - `admitters-lookup` — the cloud read itself failed (offline, 5xx, a refused
 *   routing proof). Nothing has been learned about the namespace.
 * - `no-nodes` - the cloud lists no node to admit through. An address on the
 *   invitation is not one: `admitter_addrs` is unsigned.
 * - `not-invited` — nodes serve the namespace, and the invitation names none of
 *   them. Terminal for this invitation: ask for a fresh one.
 * - `invited-unreachable` — a named node exists but cannot take a join now (no
 *   fresh heartbeat, or the cloud reports the namespace as not servable). A
 *   wait, not a wrong invitation.
 * - `no-relay-url` — a named node can admit but the cloud knows no address for
 *   it, so there is nothing to connect through afterwards. Also a wait: it is
 *   the shape a node reports before its first heartbeat lands.
 */
export type RelayResolutionStep = 'admitters-lookup' | 'no-nodes' | 'not-invited' | 'invited-unreachable' | 'no-relay-url';
/** A relay that can take this invitation's join, and connect afterwards. */
export interface ResolvedInvitationRelay {
    readonly ok: true;
    /** The node origin to connect through. */
    readonly relayUrl: string;
    /** Where to POST the signed join — the cloud's own, never rebuilt when given. */
    readonly admitUrl: string;
    /** The admitter's account, as the cloud reported it. */
    readonly admitterAccount: string | null;
    /** The node's peer id, as the cloud reported it. */
    readonly peerId: string;
    /**
     * Whether this node can also run delegated writes (`CAN_AUTHOR_ON_BEHALF`).
     *
     * `false` is not a failure of admission — see the module note. It means the
     * connection that follows will read and receive events but have its intents
     * refused, which an admin grants away, so it is worth saying out loud.
     */
    readonly writable: boolean;
    /** Whether the chosen node's heartbeat for this namespace has lapsed. */
    readonly stale: boolean;
}
export interface RelayResolutionFailure {
    readonly ok: false;
    readonly step: RelayResolutionStep;
    /** What to go and do about it, in one sentence. */
    readonly reason: string;
}
export type ResolveRelayResult = ResolvedInvitationRelay | RelayResolutionFailure;
export interface ResolveRelayFromInvitationInput {
    /** The namespace the invitation admits you to, 64 hex. */
    readonly namespaceId: string;
    /**
     * The invitation's signed `admitters` — `invitation.invitation.admitters`.
     *
     * An EMPTY list is the legacy "admission by broadcast" shape, where any ready
     * peer may admit, and is treated as such. Omitting the field and passing an
     * empty array are therefore the same thing on purpose: there is no spelling
     * here that means "nobody may admit", because an invitation cannot say that.
     */
    readonly admitters?: readonly string[];
    /** The delegated credential — an `AccountProof<DeviceCert>`, hex. */
    readonly credential: string;
    /** The certified device's ed25519 signing secret, hex. */
    readonly deviceSecret: string;
    /** Point at a cloud other than the hosted manager. For local rigs. */
    readonly cloudBaseUrl?: string;
    /** Injected in tests. Anything with the one method this needs. */
    readonly cloud?: Pick<CloudClient, 'getNamespaceRouting'>;
}
/**
 * Normalise a hex account for comparison: lower-cased, `0x` stripped.
 *
 * Both sides are hex for the same 32 bytes, and a spelling mismatch would
 * present as "your invitation does not name this node" — a refusal that looks
 * like policy and is really formatting.
 */
export declare function normaliseAccount(account: string | null | undefined): string | null;
/**
 * Resolve a relay to bootstrap through, from an invitation and nothing else.
 *
 * Reads the cloud's routing for the namespace, intersects it with the
 * invitation's signed `admitters`, and returns the node to use — or which step
 * stopped it and what that means. It performs no admission and mints no keys:
 * the credential passed in is the one the wallet already certified.
 */
export declare function resolveRelayFromInvitation(input: ResolveRelayFromInvitationInput): Promise<ResolveRelayResult>;
