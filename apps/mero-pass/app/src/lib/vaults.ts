// ── Teams, vaults, invitations ──────────────────────────────────────────────
//
// The model, with the vocabulary kept straight deliberately: a "group" is a
// SUBGROUP inside a namespace, never the namespace itself.
//
//   Team (namespace)  = a team, a household, a company   ← invite people HERE
//     └── Vault (subgroup + context)                      ← one set of secrets
//     └── Vault (subgroup + context)
//
// Before this module Mero Pass could do NEITHER half. It listed
// `admin.getContexts()` — every context on the node, whichever app made it —
// and told the user that a vault "appears here when you join a namespace that
// has one; ask whoever runs it for an invitation". There was no way to create
// the namespace, no way to create the vault, and no way to mint the invitation.
//
// Two node behaviours are encoded below and are the reason vaults are reachable
// by the people invited to a team. Both are inherited from mero-stream's
// two-node suite rather than rediscovered:
//
//   1. JOINING A NAMESPACE DOES NOT PUT YOU IN ITS SUBGROUPS. `VisibilityMode`
//      defaults to RESTRICTED, and a restricted subgroup is unreachable by the
//      members you just invited — `join-via-inheritance` returns 403.
//   2. The wire value is LOWERCASE. Core rejects "Open" with
//      `Field 'subgroup_visibility' has invalid format: must be 'open' or
//      'restricted'`. mero-js types it as a bare `string`, so nothing catches
//      the casing at compile time.
//
// ── Where a NAME lives, and why it is written twice ──────────────────────────
//
// A name the creator types has to be readable on the node of the person they
// invited. Three stores exist and they cover different stages of the journey:
//
//   * a team's name → `createNamespace({name})`, read back from
//     `listNamespacesForApplication()[].name`, PLUS the namespace's own metadata
//     record as a fallback for nodes that answer the listing without a name.
//   * a vault's name → the subgroup's METADATA record. `createGroupInNamespace`
//     takes `groupName`, the value does NOT persist, and the listing comes back
//     as a bare `{groupId}` — so `setGroupMetadata` is what makes the name
//     readable, and it is readable by any member of the team, including one who
//     has not entered the vault yet.
//   * the same vault's name → the CONTRACT, via `init`'s parameters. Contract
//     state is the authoritative copy for anyone inside the vault, and it is the
//     one that survives if the metadata record is ever lost or rewritten.
//
// What is deliberately NOT used: a `localStorage` map from context id to label.
// That is the fleet's usual shortcut and it is per-BROWSER — the creator sees
// "Shared credentials" and every person they invite sees a hex stub forever.
//
// ── What is NEVER in an invitation ───────────────────────────────────────────
//
// An invitation grants namespace membership. Nothing else travels in it: no
// secret, no vault contents, no derived key material. See `lib/inviteCodec`.

import type { MeroJs } from '@calimero-network/mero-js';
import {
  ADMIN_CAPABILITIES,
  MEMBER_CAPABILITIES,
  capabilitiesForRole,
  missingForRole,
  normaliseRole,
  roleLabel,
  type TeamRole,
} from './roles';
import {
  encodeInvite,
  groupIdOfInvite,
  type InviteChainEntry,
  type PassInvitePayload,
  type SignedInvitation,
} from './inviteCodec';

/** The admin client, as `useMero().mero.admin` provides it. */
export type AdminLike = MeroJs['admin'];

/**
 * Progress sink. Every flow in here is several round-trips deep, and a single
 * "Working…" for six seconds of network is the difference between "loading" and
 * "broken" from the user's side — so each step names itself.
 */
export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** How long to wait for a joined context's identity to land, and how often to look. */
const IDENTITY_TIMEOUT_MS = 60_000;
const IDENTITY_POLL_MS = 1_500;

/**
 * How long to keep asking a vault to admit us while the grant projects.
 *
 * ⚠️ THIS WINDOW WAS NEVER THE BUG, and it is worth saying so because the
 * symptom looked exactly like a timeout. "The vault did not admit you after
 * 20s" was a subgroup born RESTRICTED whose later opening never reached the
 * joining node — see the note in `createVault`. Retrying for sixty seconds,
 * with explicit `syncGroup` on both the namespace and the subgroup, never
 * once helped: the refusal was correct and permanent.
 *
 * Raised to the identity wait's window anyway, as defence for a genuinely
 * slow network rather than as the fix. Waiting longer costs a spinner; giving
 * up early costs the join, and the person cannot tell which happened.
 */
const ADMISSION_TIMEOUT_MS = 60_000;
const ADMISSION_POLL_MS = 1_200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descend an invitation response until we reach the object that actually carries
 * the signature. The join endpoints want the invitation OBJECT — not a JSON
 * string of it, and not a wrapper around it.
 */
export function unwrapInvitation(payload: unknown): SignedInvitation | null {
  let node: unknown = payload;
  for (let i = 0; i < 5; i++) {
    if (!node || typeof node !== 'object') return null;
    const o = node as Record<string, unknown>;
    if ('inviter_signature' in o || 'inviterSignature' in o) {
      return o as unknown as SignedInvitation;
    }
    if ('invitation' in o) node = o.invitation;
    else return null;
  }
  return null;
}

/**
 * `init(name)` takes JSON bytes — see the contract's `init`.
 *
 * This is the call that puts the vault's name into replicated state, so it is
 * the one that makes the name readable on a joiner's node.
 */
export function initParamsFor(name: string): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify({ name })));
}

/**
 * A join that is already satisfied is a SUCCESS, not a failure. Re-opening a
 * link, a retry after a timeout, and walking a chain that overlaps memberships
 * you already hold all land here — and every one of them should end with the
 * user in the vault rather than staring at "already a member" styled as an
 * error.
 */
function isAlreadyMember(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('already a member') ||
    m.includes('already member') ||
    m.includes('already joined') ||
    m.includes('alreadyjoined') ||
    m.includes('duplicate member')
  );
}

/** A 403 from the admission check, as opposed to a network or shape failure. */
function isForbidden(e: unknown): boolean {
  return /403|forbidden|not allowed|not eligible/i.test(
    e instanceof Error ? e.message : String(e),
  );
}

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * A readable label, given whatever the node was able to tell us.
 *
 * Pure, and exported, because the fallback order IS the fix for "the name
 * brings no value": a real name always beats a hex stub, and a hex stub is only
 * ever reached when nobody typed a name at all.
 */
export function displayName(
  candidates: readonly (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

// ── Teams (namespaces) ──────────────────────────────────────────────────────

/**
 * The key written into a namespace's metadata `data` map to mark it PERSONAL.
 *
 * A personal vault is not a team you happen not to have invited anyone to. It
 * is built differently (see `createPersonalVault`) and must be recognisable as
 * such on every device of the account, so the marker has to live somewhere
 * replicated. `MetadataRecord.data` is a free-form `Record<string, string>`,
 * which is the only free-form replicated field available here — the request
 * bodies are all `deny_unknown_fields`, so an invented top-level key would be a
 * 400 for the whole call.
 *
 * ⚠️ Writing metadata WHOLLY REPLACES the record: `data` defaults to `{}`
 * server-side. Anything that later sets a name on a personal namespace must
 * pass this map back, or the vault silently demotes itself to a shared team —
 * which is a privacy regression, not a cosmetic one. `markPersonal` below is
 * the only writer, and it always writes both fields together.
 */
export const PERSONAL_KIND_KEY = 'kind';
export const PERSONAL_KIND_VALUE = 'personal';

export interface TeamRow {
  namespaceId: string;
  name: string;
  memberCount: number;
  vaultCount: number;
  /**
   * True when this namespace holds ONE person's private vault.
   *
   * Read from replicated metadata rather than inferred from `memberCount === 1`:
   * a shared team looks exactly like that between being created and the first
   * invitation, and treating it as private would put a "nobody else can see
   * this" label on a vault that is one click from being shared.
   */
  personal: boolean;
}

/** Whether a metadata record carries the personal marker. */
export function isPersonalRecord(
  meta: { data?: Record<string, string> | null } | null | undefined,
): boolean {
  return meta?.data?.[PERSONAL_KIND_KEY] === PERSONAL_KIND_VALUE;
}

/**
 * Every team this node holds for Mero Pass.
 *
 * Scoped by application id — NOT by "every context on the node", which is what
 * the vault list did before and is why it showed other apps' contexts as
 * vaults.
 *
 * The metadata read is a second request per team and is worth it: it is the
 * fallback that keeps a team named when the listing answers without one, and
 * a listing with a name skips nothing because both are in flight together.
 */
export async function listTeams(
  admin: AdminLike,
  applicationId: string,
): Promise<TeamRow[]> {
  const namespaces = await admin.listNamespacesForApplication(applicationId);
  return Promise.all(
    (namespaces ?? []).map(async (n) => {
      // ⚠️ UNCONDITIONAL now. This used to be skipped whenever the listing
      // already carried a name, which was a fair saving when the record only
      // held a fallback name — but the record is also where `personal` lives,
      // and a named personal vault would have come back with `personal: false`
      // and been rendered as a shared team. Getting that wrong in this
      // direction understates privacy on screen, so the request is not optional.
      const meta = await admin
        .getGroupMetadata(n.namespaceId)
        .catch(() => null);
      return {
        namespaceId: n.namespaceId,
        name: displayName([n.name, meta?.name], n.namespaceId, 'Team'),
        personal: isPersonalRecord(meta),
        memberCount: n.memberCount ?? 0,
        // `subgroupCount` is the vault count. Preferred over listing every
        // team's groups: that would be one request per row just to render a
        // number.
        vaultCount: n.subgroupCount ?? 0,
      };
    }),
  );
}

/**
 * Give this account the Admin mask on a namespace, and confirm it landed.
 *
 * Reads back rather than trusting the write, for the reason `lib/roles` opens
 * with: a role and a capability mask are different server fields, and a write
 * that reports 200 while the mask stays where it was is exactly the failure this
 * app is most vulnerable to — the UI and the node disagree and the UI looks
 * right.
 */
async function grantAdmin(
  admin: AdminLike,
  namespaceId: string,
  accountId: string,
): Promise<number | null> {
  await admin.setMemberCapabilities(namespaceId, accountId, {
    capabilities: ADMIN_CAPABILITIES,
  });
  const after = await admin
    .getMemberCapabilities(namespaceId, accountId)
    .then((r) => r?.capabilities ?? null)
    .catch(() => null);
  if (after !== null && (after & ADMIN_CAPABILITIES) !== ADMIN_CAPABILITIES) {
    throw new Error(
      `The node accepted the permission change but did not apply it ` +
        `(asked for ${ADMIN_CAPABILITIES}, it reports ${after}).`,
    );
  }
  return after;
}

/**
 * Repair a team whose creator was never granted the Admin MASK.
 *
 * Teams made before `createTeam` granted the creator anything are stuck: the
 * creator holds the Admin ROLE (they made it) but only the Member mask, every
 * gate in this app asks the mask, and the one control that could raise it is
 * itself behind an Admin gate. This is how they get unstuck — the team screen
 * tries once on load, and a success re-reads the mask.
 *
 * ⚠️ IT ONLY ASKS WHEN IT CAN PLAUSIBLY SUCCEED, and that is not fussiness.
 *
 * It used to attempt the write whenever the mask was below Admin, on the
 * reasoning that "the NODE decides" and a refusal is harmless. The node does
 * decide, and it refuses correctly — with an HTTP 403:
 *
 *     identity AccountId([...]) is not an admin of group ContextGroupId([...])
 *
 * But that is EVERY INVITED MEMBER, on EVERY team-page load, forever: their
 * mask is Member by design and will never rise on its own, so the attempt can
 * never succeed and is retried for the life of the team. Swallowed, so the UI
 * says nothing — and the console and network tab fill with 403s that look
 * exactly like a broken app, which is how this was reported.
 *
 * ROLE is the deciding question, because role is what core's
 * `require_namespace_admin` actually checks (`MembershipRepository::is_admin`)
 * — the mask is a separate field, which is the whole reason a creator can be
 * Admin-by-role and Member-by-mask at the same time. So: ask for the role
 * first, and only reach for the write when this account really is an Admin
 * whose mask has fallen behind.
 *
 * @returns the mask afterwards when it changed, or null when it did not.
 */
export async function repairCreatorAdmin(
  admin: AdminLike,
  namespaceId: string,
  accountId: string,
  current: number | null,
): Promise<number | null> {
  if (current === null) return null;
  if ((current & ADMIN_CAPABILITIES) === ADMIN_CAPABILITIES) return null;

  // A read, and a cheap one — `listGroupMembers` is already fetched by the
  // People tab. A Member gets no further, so no 403 is ever provoked.
  const isAdminByRole = await admin
    .listGroupMembers(namespaceId)
    .then((r) =>
      (r.members ?? []).some(
        (m) => m.identity === accountId && m.role === 'Admin',
      ),
    )
    .catch(() => false);
  if (!isAdminByRole) return null;

  try {
    const after = await grantAdmin(admin, namespaceId, accountId);
    return after === current ? null : after;
  } catch {
    return null;
  }
}

/**
 * Create the team that holds vaults.
 *
 * No context is created here — that is a vault's job. A team with no vault is
 * a valid, expected state: you invite people to the team, then make vaults.
 */
export async function createTeam(
  admin: AdminLike,
  opts: { applicationId: string; name: string; accountId?: string | null },
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string }> {
  onStatus('Creating the team…');
  // `name` on the wire, at creation. Passing it here is the difference between
  // everyone seeing the name and everyone seeing a hex stub; an app that keeps
  // the name client-side instead has already lost it for every invitee.
  const ns = await admin.createNamespace({
    applicationId: opts.applicationId,
    name: opts.name,
  });

  onStatus("Recording the team's name…");
  // Belt and braces, and cheap. The namespace IS a group, so it has a metadata
  // record, and `listTeams` falls back to it when the namespace listing comes
  // back without a name.
  await admin
    .setGroupMetadata(ns.namespaceId, { name: opts.name })
    .catch(() => {});

  onStatus('Setting what an invited member may do…');
  // ⚠️ MEMBER_CAPABILITIES, not 15. The first cut of this app set 15 —
  // CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS | CAN_JOIN_OPEN_SUBGROUPS |
  // MANAGE_MEMBERS — ported from mero-stream. In a video app that is fine; in
  // a password manager it made everyone you invited a de-facto admin, able to
  // invite further people and to demote you. See `lib/roles`.
  //
  // This sets the default for FUTURE members. It does not touch anyone already
  // in the team, and it does not touch the creator: a namespace's owner holds
  // full capabilities independently of this value, which is why lowering it
  // does not lock you out of the team you just made. The merobox scenario
  // pins exactly that — node 1 creates a vault after this call.
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

  // ⚠️ AND NOW GRANT THE CREATOR ADMIN, EXPLICITLY.
  //
  // The comment above used to end "it does not touch the creator: a namespace's
  // owner holds full capabilities independently of this value". That was wrong,
  // and it produced the worst symptom this app has had. You create a team, open
  // it, and it says:
  //
  //     "You are a Member of this team, so you can open every vault below but
  //      not create new ones. An Admin can change that under People."
  //
  //     "No vaults in this team yet. An Admin can create the first one."
  //
  // You are the only person in the team. There is no Admin to ask, and no way
  // to become one — so the team is a dead end from the moment it is made.
  //
  // Every gate in this app asks `getMemberCapabilities(namespace, myAccount)`,
  // because the MASK is what the node enforces (see `lib/roles`). For the
  // creator that call returns the DEFAULT mask — which the line above had just
  // set to Member. Whatever the node does with owner authority internally is
  // not what that endpoint reports, so the UI read Member and was right to.
  //
  // Not swallowed. A team whose creator cannot put a vault in it is not a team,
  // and failing here says so while the name is still on screen.
  if (opts.accountId) {
    onStatus('Making you an admin of it…');
    await grantAdmin(admin, ns.namespaceId, opts.accountId);
  }

  onStatus('Opening the team to invited members…');
  await admin
    .setSubgroupVisibility(ns.namespaceId, { subgroupVisibility: 'open' })
    .catch(() => {});

  return { namespaceId: ns.namespaceId };
}

// ── Vaults (subgroup + context) ──────────────────────────────────────────────

export interface VaultRow {
  vaultId: string;
  name: string;
  /** The vault's context. Null while the vault exists but has not replicated here. */
  contextId: string | null;
  memberCount: number;
  /** True when this node already holds an identity in the vault's context. */
  joined: boolean;
  /** The identity this node holds in the vault's context, or null. */
  identity: string | null;
}

/**
 * The vaults in a team, each with its context and whether we can enter it.
 *
 * Fans out per vault because the subgroup listing returns only
 * `{groupId, name?}`, and `name` is not populated. A per-vault failure degrades
 * that row rather than emptying the list — a vault whose context has not
 * replicated to this node yet is the normal case right after joining, not an
 * error.
 */
export async function listVaults(
  admin: AdminLike,
  namespaceId: string,
): Promise<VaultRow[]> {
  const subgroups = await admin.listNamespaceGroups(namespaceId);
  return Promise.all(
    (subgroups ?? []).map(async (sg) => {
      const [contexts, members, meta] = await Promise.all([
        admin.listGroupContexts(sg.groupId).catch(() => []),
        admin
          .listGroupMembers(sg.groupId)
          .then((r) => r.members ?? [])
          .catch(() => []),
        // The subgroup listing returns a bare `{groupId}` — `name` is never
        // populated — so a vault's name comes from its metadata record, which
        // is where `createVault` writes it.
        admin.getGroupMetadata(sg.groupId).catch(() => null),
      ]);
      const contextId = contexts?.[0]?.contextId ?? null;
      const identity = contextId ? await ownedIdentity(admin, contextId) : null;
      return {
        vaultId: sg.groupId,
        name: displayName([sg.name, meta?.name], sg.groupId, 'Vault'),
        contextId,
        memberCount: members.length,
        joined: !!identity,
        identity,
      };
    }),
  );
}

/**
 * Create a vault: subgroup → name → OPEN visibility → its own context.
 *
 * The visibility step is not optional and not cosmetic. A vault created with
 * defaults is RESTRICTED, which means the team members you just invited get a
 * 403 from `join-via-inheritance` and can never reach the secrets.
 */
export async function createVault(
  admin: AdminLike,
  opts: { applicationId: string; namespaceId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ vaultId: string; contextId: string; memberPublicKey: string }> {
  onStatus('Creating the vault…');
  // ⚠️ `groupName`, not `name`. Every core request body is `deny_unknown_fields`,
  // so the old spelling is a 400 for the whole call rather than a silently
  // ignored key. (The value still does not persist — hence the metadata write
  // below — but the request has to be well-formed either way.)
  // ⚠️ `visibility` AT BIRTH, not only afterwards.
  //
  // A subgroup created without it is born RESTRICTED, and the
  // `setSubgroupVisibility` below is a SECOND governance write that a peer has
  // to receive separately. Measured on two nodes: a member who joined the team
  // after the vault existed saw `nsMembers=2`, its own mask, and the
  // subgroup's id — but `getGroupInfo(vaultId)` answered 500 indefinitely and
  // `joinSubgroupInheritance` answered 403 forever, through sixty seconds of
  // retries and explicit `syncGroup` on both the namespace and the subgroup.
  // From that node the vault was restricted, permanently.
  //
  // Born open, the visibility is part of the record that creates the subgroup
  // rather than an amendment to it. `createAgreement` in mero-sign carries the
  // same fix for the same reason.
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    groupName: opts.name,
    visibility: 'open',
  });

  onStatus('Naming the vault…');
  // The name, where it is actually readable by another member of the team.
  // Non-fatal: a nameless vault still holds secrets, and losing the label is
  // not worth failing a created vault over — the contract copy below is the
  // authoritative one anyway.
  await admin.setGroupMetadata(sg.groupId, { name: opts.name }).catch(() => {});

  onStatus('Opening the vault to team members…');
  // Lowercase — core rejects "Open". NOT swallowed: unlike the namespace-root
  // call, this one is load-bearing. If it fails the vault is restricted, and a
  // restricted vault silently cannot be joined by the people invited to the
  // team. Better to fail here, where the message can say so.
  await admin.setSubgroupVisibility(sg.groupId, {
    subgroupVisibility: 'open',
  });

  onStatus("Creating the vault's context…");
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: sg.groupId, // bound to the SUBGROUP, not the namespace
    // The third copy of the name, and the authoritative one: this is what the
    // contract stores and what every member reads back from `vault_name()`.
    initializationParams: initParamsFor(opts.name),
  });

  return {
    vaultId: sg.groupId,
    contextId: ctx.contextId,
    memberPublicKey: ctx.memberPublicKey,
  };
}

// ── The personal vault ───────────────────────────────────────────────────────

/**
 * Create the vault that is yours alone: its own namespace, a RESTRICTED
 * subgroup, and a context nobody is ever invited to.
 *
 * ── Why it is not a vault inside a team ──────────────────────────────────────
 *
 * `createVault` sets `subgroupVisibility: 'open'`, and it has to: an invited
 * team member reaches a vault by inheritance, and a restricted one answers
 * `join-via-inheritance` with a 403. The consequence is that EVERY vault in a
 * team is readable by every member of that team — which is the correct model
 * for shared credentials and a fatal one for private ones. A "private vault"
 * placed in a team namespace would be self-joinable by every colleague in it.
 *
 * So the isolation boundary is the NAMESPACE, not the subgroup. Nobody is ever
 * a member of this namespace except you, which means there is no one for
 * inheritance to admit.
 *
 * ── The four things that make it private, in order of what breaks ────────────
 *
 *   1. its own namespace, with no invitation ever minted against it;
 *   2. `defaultCapabilities: 0`, so a member arriving by any route this app
 *      does not know about can do nothing;
 *   3. the namespace root is NOT opened — `createTeam` opens it so invitees can
 *      reach vaults, and that step is simply absent here;
 *   4. the subgroup is explicitly RESTRICTED rather than left to default.
 *
 * (4) is belt and braces on (1): restricted IS the server default, and the
 * comment at the top of this file says so. It is written out anyway because the
 * default is a property of a core release, this app already carries a note
 * about a core release changing a default under it, and a password manager is
 * the wrong place to depend on one. Unlike the `open` call in `createVault`
 * this one is NOT swallowed: if the node will not make the subgroup restricted,
 * the honest outcome is a failure, not a vault that quietly is not private.
 *
 * ── Multi-device ─────────────────────────────────────────────────────────────
 *
 * Namespace membership is per ACCOUNT, so a second device of the same account
 * sees this namespace and syncs the vault. That is the intended behaviour —
 * your own passwords on your own devices — and it is why the marker is written
 * to replicated metadata rather than to `localStorage`.
 */
export async function createPersonalVault(
  admin: AdminLike,
  opts: { applicationId: string; name?: string },
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string; vaultId: string; contextId: string }> {
  const name = (opts.name ?? '').trim() || 'Personal';

  onStatus('Creating your private vault…');
  const ns = await admin.createNamespace({
    applicationId: opts.applicationId,
    name,
  });

  onStatus('Marking it private…');
  // Name and marker in ONE write, because a write replaces the record. Not
  // swallowed: without the marker this namespace is indistinguishable from a
  // team, and the UI would offer an "Invite someone" menu on a private vault.
  await admin.setGroupMetadata(ns.namespaceId, {
    name,
    data: { [PERSONAL_KIND_KEY]: PERSONAL_KIND_VALUE },
  });

  onStatus('Closing it to everyone else…');
  // Nobody should ever be a member here, so anyone who somehow is gets nothing.
  // Not swallowed, for the reason spelled out in `createTeam` — and it matters
  // more here. A private vault's namespace must grant an arriving member
  // NOTHING; rc.41's seed would give them `CAN_AUTHOR_ON_BEHALF`, which is the
  // capability to write as the vault's owner.
  await admin.setDefaultCapabilities(ns.namespaceId, {
    defaultCapabilities: 0,
  });

  // NOTE: no `setSubgroupVisibility(ns.namespaceId, 'open')`. `createTeam` makes
  // that call so invited members can reach the team's vaults; its ABSENCE is
  // part of what makes this vault private, so it is called out rather than
  // merely missing.

  onStatus('Creating the vault…');
  const sg = await admin.createGroupInNamespace(ns.namespaceId, {
    groupName: name,
  });
  await admin.setGroupMetadata(sg.groupId, { name }).catch(() => {});

  onStatus('Keeping it closed…');
  await admin.setSubgroupVisibility(sg.groupId, {
    subgroupVisibility: 'restricted',
  });

  onStatus('Preparing storage…');
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: sg.groupId,
    initializationParams: initParamsFor(name),
  });

  return {
    namespaceId: ns.namespaceId,
    vaultId: sg.groupId,
    contextId: ctx.contextId,
  };
}

/**
 * Throw if this namespace is someone's personal vault.
 *
 * Called by both mint paths. The UI does not render an invite control for a
 * personal vault, and that is the right UX — but "the button is not on screen"
 * is not an access control. A stale tab, a saved deep link, a future screen, or
 * a caller written six months from now all reach the library directly, and the
 * cost of being wrong here is publishing a link to one person's private
 * passwords. So the refusal lives next to the operation it refuses.
 */
async function refuseIfPersonal(
  admin: AdminLike,
  namespaceId: string,
): Promise<void> {
  // ⚠️ A FAILED READ IS TREATED AS PERSONAL. The safe default under an
  // unreachable node is to decline to mint, not to mint anyway: declining
  // costs an invitation that can be retried, and the alternative cost is
  // unbounded. This is the one place in the app where a node hiccup blocks a
  // legitimate action, and that trade is deliberate.
  let meta: Awaited<ReturnType<AdminLike['getGroupMetadata']>> | null;
  try {
    meta = await admin.getGroupMetadata(namespaceId);
  } catch {
    throw new Error(
      'Could not confirm whether this is your private vault, so no invitation ' +
        'was created. Check the node connection and try again.',
    );
  }
  if (isPersonalRecord(meta)) {
    throw new Error(
      'This is your private vault. It has no members but you, and it cannot be ' +
        'shared — create a team if you want to share credentials with someone.',
    );
  }
}

// ── Invitations ──────────────────────────────────────────────────────────────

/**
 * Mint an OPEN team invitation and encode it as one pasteable code.
 *
 * OPEN means the invitation carries no invitee key, so anyone holding the code
 * can join. Deliberately do NOT pass `inviteePublicKey`: it is silently ignored
 * and misleads the next reader.
 */
export async function mintTeamInvite(
  admin: AdminLike,
  opts: { namespaceId: string; teamName?: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  await refuseIfPersonal(admin, opts.namespaceId);
  onStatus('Minting an invitation…');
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error('The node returned an invitation with no signature.');
  }
  onStatus('Encoding the invite code…');
  return encodeInvite({
    invitation,
    kind: 'namespace',
    groupAlias: opts.teamName,
    groupId: opts.namespaceId,
  });
}

/**
 * Mint a code that lands someone in ONE VAULT.
 *
 * The grant is the SPACE invitation, and that is not a shortcut — it is how
 * vault access works. Vault membership is INHERITED: a joiner must hold the
 * parent before a subgroup will admit them, and once they do,
 * `joinSubgroupInheritance` lets them into any OPEN vault in it (which is every
 * vault this app makes, because a restricted one cannot be joined by invited
 * members at all).
 *
 * So a vault code is "team grant + open this vault", and the UI says exactly
 * that rather than implying a narrower grant than it gives. ⚠️ THIS MATTERS
 * MORE HERE THAN IN A CHAT APP: the person accepting is being given access to
 * every vault in the team, not just the one named, and a password manager must
 * not misrepresent that.
 */
export async function mintVaultInvite(
  admin: AdminLike,
  opts: {
    namespaceId: string;
    vaultId: string;
    vaultName?: string;
    teamName?: string;
    contextId?: string | null;
  },
  onStatus: StatusFn = noop,
): Promise<string> {
  await refuseIfPersonal(admin, opts.namespaceId);
  onStatus('Minting an invitation for this vault…');
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error('The node returned an invitation with no signature.');
  }

  onStatus('Encoding the invite code…');
  return encodeInvite({
    invitation,
    kind: 'vault',
    groupId: opts.namespaceId,
    // Routing hints, outside the signature and unable to grant anything: the
    // node still decides whether to admit the joiner to this vault.
    vaultId: opts.vaultId,
    contextId: opts.contextId ?? undefined,
    vaultName: opts.vaultName,
    groupAlias: opts.teamName,
  });
}

// ── Joining ──────────────────────────────────────────────────────────────────

export interface AcceptedInvite {
  namespaceId: string | null;
  vaultId: string | null;
  /** Carried by the code as a hint; may not have replicated to this node yet. */
  contextId: string | null;
  vaultName?: string;
  teamName?: string;
}

/** Where a redeemed invitation should land the user. */
export type Redeemed =
  | {
      kind: 'vault';
      contextId: string;
      identity: string;
      vaultName?: string;
      /** The team the vault belongs to, when the invitation named it. */
      namespaceId?: string;
    }
  | { kind: 'team'; namespaceId: string }
  | { kind: 'joined' };

/**
 * Accept a decoded invite: walk its chain, or join the single group it names.
 *
 * The id acted on always comes from INSIDE the signed invitation, never from the
 * wrapper, so a tampered code cannot redirect a join somewhere else.
 */
export async function acceptInvite(
  admin: AdminLike,
  payload: PassInvitePayload,
  onStatus: StatusFn = noop,
): Promise<AcceptedInvite> {
  const result: AcceptedInvite = {
    namespaceId: null,
    // Routing hints from the code. Unsigned, so they steer navigation only —
    // whether we are actually let into this vault is the node's decision, made
    // against the membership the signed invitation just established.
    vaultId: payload.vaultId ?? null,
    contextId: payload.contextId ?? null,
    vaultName: payload.vaultName,
    teamName: payload.groupAlias,
  };

  // A vault code's GRANT is the team (see `mintVaultInvite`), so the join step
  // is a namespace join regardless of where the code points. Only an explicit
  // chain entry describes a subgroup invitation.
  const steps: InviteChainEntry[] = payload.chain ?? [
    {
      groupId: groupIdOfInvite(payload),
      invitation: payload.invitation,
      kind: 'namespace',
    },
  ];

  for (const step of steps) {
    // Trust the signature, not the label: re-read the id from the signed blob.
    const signedId = groupIdOfInvite(step.invitation) || step.groupId;
    const label =
      step.kind === 'namespace'
        ? `team${payload.groupAlias ? ` “${payload.groupAlias}”` : ''}`
        : `vault${payload.vaultName ? ` “${payload.vaultName}”` : ''}`;
    onStatus(`Joining the ${label}…`);
    try {
      if (step.kind === 'namespace') {
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
    if (step.kind === 'namespace') result.namespaceId = signedId;
    else result.vaultId = signedId;
  }

  // A vault invite whose chain had no namespace entry still needs one to
  // navigate to; ask the node which team the vault sits under.
  if (!result.namespaceId && result.vaultId) {
    result.namespaceId = await parentNamespaceOf(admin, result.vaultId);
  }
  return result;
}

/**
 * Accept an invitation and enter whatever it granted.
 *
 * Extracted so the link path and any future paste path cannot drift. A vault
 * invitation needs BOTH joins — the team grant and then the vault's context —
 * and forgetting the second leaves someone a member of a team staring at a
 * vault they cannot open.
 */
export async function redeemInvite(
  admin: AdminLike,
  payload: PassInvitePayload,
  onStatus: StatusFn = noop,
): Promise<Redeemed> {
  const accepted = await acceptInvite(admin, payload, onStatus);

  if (accepted.vaultId && accepted.contextId) {
    const identity = await enterVaultContext(
      admin,
      {
        vaultId: accepted.vaultId,
        contextId: accepted.contextId,
        // Known here, and this is the path where it matters most: a joiner is
        // entering a vault seconds after the grant, so the namespace state is
        // exactly what has not arrived yet.
        namespaceId: accepted.namespaceId ?? undefined,
      },
      onStatus,
    );
    return {
      kind: 'vault',
      contextId: accepted.contextId,
      identity,
      vaultName: accepted.vaultName,
      namespaceId: accepted.namespaceId ?? undefined,
    };
  }
  if (accepted.namespaceId) {
    return { kind: 'team', namespaceId: accepted.namespaceId };
  }
  return { kind: 'joined' };
}

/**
 * Which team a vault belongs to, discovered by looking for it among the
 * namespaces this node knows. There is no "parent of" read in the admin API, and
 * the invite wrapper's claim is unsigned, so this is the honest way to get it.
 */
async function parentNamespaceOf(
  admin: AdminLike,
  vaultId: string,
): Promise<string | null> {
  const namespaces = await admin.listNamespaces().catch(() => []);
  for (const ns of namespaces ?? []) {
    const vaults = await admin
      .listNamespaceGroups(ns.namespaceId)
      .catch(() => []);
    if ((vaults ?? []).some((v) => v.groupId === vaultId))
      return ns.namespaceId;
  }
  return null;
}

/**
 * The identity this node holds in a context, or null when it holds none.
 *
 * ⚠️ This is the context EXECUTOR identity, not the account id. Both are 64 hex
 * characters since rc.27, so passing the wrong one type-checks, sends, and is
 * refused as an unauthorized signer rather than as a bad argument.
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
 * Join a vault by inheritance, retrying while the node says "not eligible".
 *
 * A 403 here is NOT proof that the vault is restricted. Inheritance is checked
 * against the team membership as this node has PROJECTED it, and a membership
 * that exists is not yet a membership that confers anything — on a cold join the
 * grant arrives over gossip and is projected a moment later. The redeem path
 * joins the team and enters the vault back to back, so it lands inside exactly
 * that window.
 */
async function joinVaultWithRetry(
  admin: AdminLike,
  vaultId: string,
  onStatus: StatusFn,
  namespaceId?: string,
): Promise<void> {
  const started = Date.now();
  const deadline = started + ADMISSION_TIMEOUT_MS;
  let lastError: unknown = null;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await admin.joinSubgroupInheritance(vaultId);
      return;
    } catch (e) {
      // Re-joining something already held is success, not failure.
      if (isAlreadyMember(e)) return;
      // Anything that is not an admission refusal is a real error: a bad id, a
      // shape rejection, an unreachable node. Retrying those just delays the
      // message by the length of the window.
      if (!isForbidden(e)) throw e;
      lastError = e;
      // ⚠️ SAY HOW LONG, every time — not once on the first attempt. This can
      // legitimately take most of a minute, and a message that never changes
      // is indistinguishable from a hang. It is the difference between
      // "working" and "broken" to the person watching it.
      const waited = Math.round((Date.now() - started) / 1000);
      onStatus(
        attempt === 1
          ? 'Waiting for your membership to reach this node…'
          : `Waiting for your membership to reach this node… ${waited}s`,
      );
      // Both groups. Inheritance eligibility is decided against the PARENT,
      // so the namespace is worth nudging; the subgroup's own record is what
      // carries its visibility. Measured: neither sync rescues a subgroup
      // that was born restricted, so this is opportunism rather than a
      // mechanism to rely on.
      if (namespaceId) await admin.syncGroup(namespaceId).catch(() => {});
      await admin.syncGroup(vaultId).catch(() => {});
      await sleep(ADMISSION_POLL_MS);
    }
  }

  const msg =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `The vault did not admit you after ${Math.round(ADMISSION_TIMEOUT_MS / 1000)}s ` +
      `(${msg}). ${await diagnoseAdmission(admin, vaultId)}`,
  );
}

/**
 * Work out WHY a vault refused us, instead of asserting a cause.
 *
 * The two candidates look identical from a 403 and want opposite responses — one
 * is "wait or rejoin the team", the other is "this vault can never admit anyone
 * invited to the team". Guessing sends people to check a setting that is
 * usually correct, so ask the node which it is.
 *
 * Best-effort by construction: this runs on a path that is already failing, so
 * every read is allowed to fail and the answer degrades to naming both
 * possibilities rather than throwing a second error over the first.
 */
async function diagnoseAdmission(
  admin: AdminLike,
  vaultId: string,
): Promise<string> {
  const visibility = await admin
    .getSubgroupVisibility(vaultId)
    .then((v) => String(v ?? '').toLowerCase())
    .catch(() => '');

  if (visibility === 'restricted') {
    return (
      'The vault is RESTRICTED, so being in the team does not admit you — ' +
      'whoever created it has to open it, or invite you to the vault directly.'
    );
  }

  const namespaceId = await parentNamespaceOf(admin, vaultId).catch(() => null);
  if (!namespaceId) {
    return (
      'This node cannot see which team the vault belongs to, which means the ' +
      'team has not replicated here yet — rejoin the team, then try again.'
    );
  }

  if (visibility === 'open') {
    return (
      'The vault is open, so this is your membership of the team not having ' +
      'reached this node yet. Try again in a moment; if it persists, rejoin ' +
      'the team from the invitation.'
    );
  }

  return (
    "Could not read the vault's visibility. Either your membership of the " +
    'team has not reached this node yet, or the vault was created restricted.'
  );
}

/**
 * Get into a vault's context, and return the member identity to act as.
 *
 * Three stages, because each is genuinely needed:
 *
 *   1. Already hold an identity? Done — opening a vault you are in must be
 *      instant.
 *   2. Self-admit into the OPEN subgroup (`joinSubgroupInheritance`). This is
 *      the step whose absence makes vaults unreachable: joining a team does
 *      NOT put you in its vaults.
 *   3. Then WAIT. ⚠️ Auto-follow only joins you to contexts created AFTER you
 *      joined the team, so for a vault that already existed it carries nothing
 *      — poll, then fall back to an explicit `joinContext`.
 */
export async function enterVaultContext(
  admin: AdminLike,
  opts: { vaultId: string; contextId: string; namespaceId?: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Checking your membership…');
  const existing = await ownedIdentity(admin, opts.contextId);
  if (existing) return existing;

  onStatus('Joining the vault…');
  // `namespaceId` is optional because two callers reach here from a context id
  // alone. Supplying it is what lets the retry sync the group whose membership
  // is actually propagating — see `joinVaultWithRetry`.
  await joinVaultWithRetry(admin, opts.vaultId, onStatus, opts.namespaceId);

  onStatus('Waiting for your identity in the vault…');
  const deadline = Date.now() + IDENTITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const again = await ownedIdentity(admin, opts.contextId);
    if (again) return again;
    await sleep(IDENTITY_POLL_MS);
  }

  onStatus("Joining the vault's context directly…");
  const joined = await admin.joinContext(opts.contextId);
  const identity = joined?.memberPublicKey;
  if (!identity) {
    throw new Error(
      'Joined the vault but no member identity arrived — the context may not have replicated to this node yet.',
    );
  }
  return identity;
}

/**
 * Locate the team and subgroup a context belongs to.
 *
 * The vault page is routed by CONTEXT id — that is what a vault is, from the
 * inside — but minting an invitation needs the NAMESPACE, and a context knows
 * nothing about its parents: there is no "parent of" read in the admin API. So
 * walk this app's teams and their subgroups until the context turns up.
 *
 * Bounded by (teams x vaults) for one node's own data, and only run when the
 * user asks to invite someone, not on every render.
 *
 * Returns null when the context is not one of this app's vaults — a context
 * from another app, or a team that has not replicated here yet — and the
 * caller reports that rather than minting an invitation to the wrong group.
 */
export async function findVaultByContext(
  admin: AdminLike,
  applicationId: string,
  contextId: string,
): Promise<{
  namespaceId: string;
  vaultId: string;
  teamName: string;
  vaultName: string;
  /** True when this vault's namespace is the caller's personal one. */
  personal: boolean;
} | null> {
  const teams = await listTeams(admin, applicationId).catch(() => []);
  for (const team of teams) {
    const vaults = await listVaults(admin, team.namespaceId).catch(() => []);
    const hit = vaults.find((v) => v.contextId === contextId);
    if (hit) {
      return {
        namespaceId: team.namespaceId,
        vaultId: hit.vaultId,
        teamName: team.name,
        vaultName: hit.name,
        personal: team.personal,
      };
    }
  }
  return null;
}

// ── People, and what they may do ─────────────────────────────────────────────
//
// ⚠️ EVERYTHING HERE IS KEYED BY AN **ACCOUNT**, NEVER BY A SIGNING KEY AND
// NEVER BY A CONTEXT EXECUTOR IDENTITY.
//
// Since rc.27 an account id, a device key and a context executor identity are
// all 64 hex characters. Passing the wrong one type-checks, sends, returns
// 200, and names a principal that exists nowhere — so a promotion silently
// authorises nobody and the roster still shows the old role. The three places
// this app holds a 64-hex string, and which is which:
//
//   useNodeIdentity().identity.accountId     ← ACCOUNT. Used here.
//   useNodeIdentity().identity.publicKey     ← the DEVICE's signing key.
//   getContextIdentitiesOwned(ctx).identities[0]
//                                            ← the CONTEXT EXECUTOR, used by
//                                              `lib/vault.ts` to sign RPC.
//
// `listGroupMembers` rows are keyed by the first. `ownedIdentity` above returns
// the third. They are not interchangeable and there is no runtime check that
// would catch a swap.

/** One person in a team, with what the node says they may actually do. */
export interface TeamMember {
  /** The member's ACCOUNT, 64 hex. What every call in this section takes. */
  accountId: string;
  name: string;
  role: TeamRole;
  /** The role string exactly as the node spells it, for display when it is unusual. */
  rawRole: string;
  /** The enforced capability bitmask, or null when it could not be read. */
  capabilities: number | null;
  isSelf: boolean;
}

/**
 * The people in a team, each with their ROLE and their real CAPABILITIES.
 *
 * Both, because they can disagree and the disagreement is the bug worth
 * surfacing: a row that says "Admin" next to a mask missing MANAGE_MEMBERS is
 * somebody who was promoted by label only, and the UI should be able to say so
 * rather than offering them controls that 403.
 *
 * A capability read that fails degrades that one row to `null` rather than
 * emptying the list.
 */
export async function listTeamMembers(
  admin: AdminLike,
  namespaceId: string,
  selfAccountId: string | null,
): Promise<TeamMember[]> {
  const res = await admin.listGroupMembers(namespaceId);
  const members = res.members ?? [];
  return Promise.all(
    members.map(async (m) => {
      const capabilities = await admin
        .getMemberCapabilities(namespaceId, m.identity)
        .then((r) => r?.capabilities ?? null)
        .catch(() => null);
      return {
        accountId: m.identity,
        name: displayName([m.name], m.identity, 'Member'),
        role: normaliseRole(m.role),
        rawRole: m.role ?? '',
        capabilities,
        isSelf: !!selfAccountId && m.identity === selfAccountId,
      };
    }),
  );
}

/** This node's own capabilities in a team, or null when they cannot be read. */
export async function myCapabilities(
  admin: AdminLike,
  namespaceId: string,
  accountId: string,
): Promise<number | null> {
  return admin
    .getMemberCapabilities(namespaceId, accountId)
    .then((r) => r?.capabilities ?? null)
    .catch(() => null);
}

/** What `setMemberRole` managed to do, reported honestly. */
export interface RoleChange {
  role: TeamRole;
  /** The mask the node reports AFTER the change, or null if it could not be read. */
  capabilities: number | null;
  /** Capabilities the new role wants that have not landed yet. Empty on success. */
  missing: string[];
  /** True when the node's mask satisfies the role in full. */
  effective: boolean;
}

/**
 * Promote or demote a member of a team.
 *
 * ── Why this is two writes and a read, not one write ─────────────────────────
 *
 * `updateMemberRole` sets a STRING. Nothing in the node enforces anything from
 * it; authorisation is the capability bitmask, set separately by
 * `setMemberCapabilities`. Writing only the role produces a roster that says
 * "Admin" beside a person who is refused by every admin endpoint — the UI and
 * the node disagreeing, with the UI looking correct. So both are written, in
 * that order, and then the mask is READ BACK so the caller can report what
 * actually took effect rather than assuming.
 *
 * ── Why a short read-back is not a failure ───────────────────────────────────
 *
 * A grant is published as an op and PROJECTED by each node a moment later; it
 * confers nothing until it is. The read-back here is against the node that
 * issued the change, so it is normally immediate, but the person being promoted
 * is on a different node and their grant arrives over gossip. `missing` names
 * whichever bits are not there yet instead of claiming success or failure.
 *
 * ── What a DEMOTION does and does not do ─────────────────────────────────────
 *
 * ⚠️ Demotion removes the governance bits. It does NOT remove the person from
 * the team, it does NOT close the vaults to them — a Member keeps
 * CAN_JOIN_OPEN_SUBGROUPS and can still read and write every secret — and,
 * most importantly, it CANNOT un-sync what their node already holds. Every
 * vault they had entered is replicated on their machine. Demoting somebody
 * stops them governing the team from this moment on; the only thing that
 * actually protects a secret they have already seen is rotating that secret.
 * The UI says this in the confirmation, and it is said here so that the next
 * person reading this function is not the one who has to discover it.
 */
export async function setMemberRole(
  admin: AdminLike,
  opts: { namespaceId: string; accountId: string; role: TeamRole },
  onStatus: StatusFn = noop,
): Promise<RoleChange> {
  const wanted = capabilitiesForRole(opts.role);

  onStatus(`Setting the role to ${roleLabel(opts.role)}…`);
  // Capitalised: core's `MemberRole` accepts several spellings, and this is the
  // one its own enum serialises to.
  await admin.updateMemberRole(opts.namespaceId, opts.accountId, {
    role: roleLabel(opts.role),
  });

  onStatus('Granting the capabilities that role means…');
  // NOT swallowed. A role without its capabilities is the exact failure this
  // whole function exists to prevent, so if this throws the caller must hear
  // about it rather than show a promotion that did nothing.
  await admin.setMemberCapabilities(opts.namespaceId, opts.accountId, {
    capabilities: wanted,
  });

  onStatus('Checking what the node actually applied…');
  const capabilities = await myCapabilities(
    admin,
    opts.namespaceId,
    opts.accountId,
  );
  const missing = missingForRole(capabilities, opts.role);
  return {
    role: opts.role,
    capabilities,
    missing,
    effective: missing.length === 0,
  };
}
