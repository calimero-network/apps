// ── Workspaces, agreements, invitations ─────────────────────────────────────
//
// The model, in the fleet's vocabulary — a "group" is a SUBGROUP inside a
// namespace, never the namespace itself:
//
//   Workspace (namespace)  = the people          ← invite people HERE
//     └── Agreement (subgroup + context)          ← one document set
//     └── Agreement (subgroup + context)
//
// ── Why this file exists at all ─────────────────────────────────────────────
//
// Mero Sign was built on "one agreement is one context, and there are no
// namespaces". That model stopped working at 0.11.0-rc.41, and not subtly:
// core's `CreateContextRequest` declares
//
//     pub group_id: String,
//
// with no `Option` and no `#[serde(default)]`. A context belongs to a namespace
// or a subgroup, always. The old path posted `{applicationId,
// initializationParams, protocol}` — no group at all, plus `protocol`, which
// core removed — and every admin body is `deny_unknown_fields`, so it was
// refused twice over. Creating an agreement returned 400 and the app had no way
// to make one.
//
// So the binding is not a nicety to be added later; it is the thing that makes
// the call legal. Given a namespace is required, it is worth making it mean
// something, and the fleet already has the shape: mero-pass (team → vault),
// mero-forum (space → forum), mero-docs (workspace → folder). Same structure
// here, so invitations, roles and names behave the way they do everywhere else.
//
// ── The two node behaviours this encodes ────────────────────────────────────
//
//   1. JOINING A NAMESPACE DOES NOT PUT YOU IN ITS SUBGROUPS. `VisibilityMode`
//      defaults to RESTRICTED, and a restricted subgroup answers
//      `join-via-inheritance` with a 403 — so an invited member could never
//      reach the agreement they were invited to.
//   2. THE WIRE VALUE IS LOWERCASE. Core rejects "Open" with
//      `Field 'subgroup_visibility' has invalid format: must be 'open' or
//      'restricted'`, and mero-js types it as a bare `string`, so nothing
//      catches the casing at compile time.
//
// ── Where a NAME lives ──────────────────────────────────────────────────────
//
//   * a workspace's name → `createNamespace({name})`, plus its metadata record
//     as the fallback for nodes that answer the listing without one.
//   * an agreement's name → the subgroup's METADATA record.
//     `createGroupInNamespace` takes `groupName`, the value does NOT persist,
//     and the listing returns a bare `{groupId}` — so `setGroupMetadata` is
//     what makes the name readable by a member who has not entered yet.
//   * the same name → the CONTRACT, via `init`'s second parameter. That is the
//     authoritative copy for anyone inside, and it survives the metadata record
//     being lost or rewritten.
//
// ⚠️ `init` TAKES TWO PARAMETERS — `(is_private: bool, context_name: String)`.
// Surplus or missing fields are a guest panic, not a validation error:
// "init: takes no arguments, but the call sent unknown field(s)". This fleet
// has shipped that exact 400 to production twice.
//
// ── What is NEVER in an invitation ──────────────────────────────────────────
//
// An invitation grants namespace membership. No document, no signature, no key
// material. See `lib/inviteCodec`.

import type { MeroJs } from '@calimero-network/mero-js';
import { CAPABILITIES } from '@calimero-network/mero-js';

export type AdminLike = MeroJs['admin'];
export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/**
 * What an invited signer may do: enter the workspace's agreements, and nothing
 * else. Governance — making agreements, inviting people, changing roles — is
 * the admin set.
 *
 * ⚠️ NOT 15, and NOT the node's default. rc.41 seeds a new namespace with
 * `CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF` (core #3969), and
 * `CAN_AUTHOR_ON_BEHALF` is "write as somebody else under a warrant they
 * signed". In a document-signing app that is the one capability that must never
 * be handed out by default, so the seed is overwritten and the write is not
 * swallowed.
 */
export const MEMBER_CAPABILITIES = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;

export const ADMIN_CAPABILITIES =
  MEMBER_CAPABILITIES |
  CAPABILITIES.CAN_CREATE_CONTEXT |
  CAPABILITIES.CAN_INVITE_MEMBERS |
  CAPABILITIES.MANAGE_MEMBERS |
  CAPABILITIES.CAN_CREATE_SUBGROUP |
  CAPABILITIES.CAN_MANAGE_VISIBILITY |
  CAPABILITIES.CAN_MANAGE_METADATA;

/**
 * `init`'s arguments, as the JSON `initializationParams` of `createContext`.
 *
 * Positional, matching the ABI exactly: `(is_private, context_name)`.
 */
export function initParamsFor(name: string, isPrivate = false): number[] {
  return Array.from(
    new TextEncoder().encode(
      JSON.stringify({ is_private: isPrivate, context_name: name }),
    ),
  );
}

/** A readable label, or a short id — never an empty string. */
export function displayName(
  candidates: (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

// ── Workspaces (namespaces) ─────────────────────────────────────────────────

export interface WorkspaceRow {
  namespaceId: string;
  name: string;
  memberCount: number;
  agreementCount: number;
}

export async function listWorkspaces(
  admin: AdminLike,
  applicationId: string,
): Promise<WorkspaceRow[]> {
  const namespaces = await admin.listNamespacesForApplication(applicationId);
  const rows = await Promise.all(
    (namespaces ?? []).map(async (n) => {
      const meta = await admin
        .getGroupMetadata(n.namespaceId)
        .catch(() => null);
      return {
        namespaceId: n.namespaceId,
        name: displayName([n.name, meta?.name], n.namespaceId, 'Workspace'),
        memberCount: n.memberCount ?? 0,
        agreementCount: n.subgroupCount ?? 0,
        // ⚠️ The personal namespace is NOT a workspace and must not be offered
        // as one. It holds this node's private signature library, it has no
        // other member and inviting somebody into it would share that library.
        personal: isPersonalRecord(meta),
      };
    }),
  );
  return rows
    .filter((r) => !r.personal)
    .map((r) => ({
      namespaceId: r.namespaceId,
      name: r.name,
      memberCount: r.memberCount,
      agreementCount: r.agreementCount,
    }));
}

/**
 * Create the workspace that holds agreements.
 *
 * No context here — that is an agreement's job. A workspace with no agreement
 * is a valid state: you invite the people first, then draw up the document.
 */
export async function createWorkspace(
  admin: AdminLike,
  opts: { applicationId: string; name: string; accountId?: string | null },
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string }> {
  onStatus('Creating the workspace…');
  const ns = await admin.createNamespace({
    applicationId: opts.applicationId,
    name: opts.name,
  });

  onStatus("Recording the workspace's name…");
  await admin
    .setGroupMetadata(ns.namespaceId, { name: opts.name })
    .catch(() => {});

  onStatus('Setting what an invited signer may do…');
  // ⚠️ NOT swallowed. See MEMBER_CAPABILITIES: at rc.41 losing this write hands
  // every invited signer CAN_AUTHOR_ON_BEHALF instead of withholding a
  // capability, and nothing reports it.
  await admin.setDefaultCapabilities(ns.namespaceId, {
    defaultCapabilities: MEMBER_CAPABILITIES,
  });

  onStatus('Making you an admin of it…');
  // The creator's own mask, explicitly. `getMemberCapabilities` reports the
  // DEFAULT for the creator, which was just set to the signer mask — so
  // without this the person who made the workspace cannot put an agreement in
  // it, and there is no admin to ask.
  if (opts.accountId) {
    await admin.setMemberCapabilities(ns.namespaceId, opts.accountId, {
      capabilities: ADMIN_CAPABILITIES,
    });
    const after = await admin
      .getMemberCapabilities(ns.namespaceId, opts.accountId)
      .then((r) => r?.capabilities ?? null)
      .catch(() => null);
    if (after !== null && (after & ADMIN_CAPABILITIES) !== ADMIN_CAPABILITIES) {
      throw new Error(
        `The node accepted the permission change but did not apply it ` +
          `(asked for ${ADMIN_CAPABILITIES}, it reports ${after}).`,
      );
    }
  }

  onStatus('Opening the workspace to invited signers…');
  await admin
    .setSubgroupVisibility(ns.namespaceId, { subgroupVisibility: 'open' })
    .catch(() => {});

  return { namespaceId: ns.namespaceId };
}

// ── The personal workspace ──────────────────────────────────────────────────
//
// Mero Sign keeps a PRIVATE context per node: the signature library, plus the
// bookkeeping `ClientApiDataSource` reads at four other call sites. It is
// created by `DefaultContextService` with `{is_private: true, context_name:
// 'default'}` and it is not shared with anybody, ever.
//
// ⚠️ IT IS A CONTEXT, so rc.41 requires a group for it exactly as it does for
// an agreement — `CreateContextRequest.group_id` has no `Option` and no
// `#[serde(default)]`. "Private" is a property of the CONTRACT (`is_private`),
// not an exemption from the binding. So the private context needs a namespace
// too, and it must not be one of the user's workspaces: a workspace is a thing
// you invite people into, and this is the one context that must never have a
// second member.
//
// Hence a namespace of its own, found by a MARKER rather than by its name. A
// name is what a user can rename; if "which namespace is my private one" turned
// on the string "Personal", renaming it would strand the signature library and
// silently start a second one.

/** The marker that says "this namespace is this node's private store". */
export const PERSONAL_KIND = 'mero-sign:personal';

/** The name shown if a personal namespace is ever surfaced in a listing. */
export const PERSONAL_WORKSPACE_NAME = 'Personal';

/** The subgroup the private context is bound to, inside that namespace. */
export const PERSONAL_GROUP_NAME = 'Private';

/** Does this metadata record mark a personal namespace? */
export function isPersonalRecord(
  meta: { data?: Record<string, string> | null } | null | undefined,
): boolean {
  return meta?.data?.kind === PERSONAL_KIND;
}

/**
 * Find this node's personal namespace, or make one.
 *
 * Idempotent, and deliberately so: it runs on a timer from
 * `useDefaultContext`, from `redeemInvitation`, and from four lazy call sites
 * in the data source, so it will be called concurrently and repeatedly. The
 * marker read is what makes a second call cheap and a second NAMESPACE
 * impossible.
 */
export async function ensurePersonalWorkspace(
  admin: AdminLike,
  applicationId: string,
  onStatus: StatusFn = noop,
): Promise<string> {
  const namespaces = await admin
    .listNamespacesForApplication(applicationId)
    .catch(() => []);

  for (const n of namespaces ?? []) {
    const meta = await admin.getGroupMetadata(n.namespaceId).catch(() => null);
    if (isPersonalRecord(meta)) return n.namespaceId;
  }

  onStatus('Setting up your private store…');
  const ns = await admin.createNamespace({
    applicationId,
    name: PERSONAL_WORKSPACE_NAME,
  });

  // ⚠️ NOT swallowed, unlike the cosmetic metadata writes elsewhere in this
  // file. The marker IS the identity of this namespace. If the write is lost,
  // the next call does not find it, creates another, and the node accumulates
  // a new "personal" namespace — and a new empty signature library — on every
  // boot. `setGroupMetadata` REPLACES the record, so name and data go together.
  await admin.setGroupMetadata(ns.namespaceId, {
    name: PERSONAL_WORKSPACE_NAME,
    data: { kind: PERSONAL_KIND },
  });

  return ns.namespaceId;
}

/**
 * The private context itself: its subgroup, then the context bound to it.
 *
 * ⚠️ VISIBILITY IS LEFT AT THE DEFAULT, which is RESTRICTED — the one place in
 * this app where that is the wanted answer. `createAgreement` opens its
 * subgroup so invited signers can enter; opening this one would make a node's
 * private signature library reachable by anybody admitted to the namespace.
 */
export async function createPersonalContext(
  admin: AdminLike,
  opts: { applicationId: string; namespaceId: string; name?: string },
  onStatus: StatusFn = noop,
): Promise<{ groupId: string; contextId: string; memberPublicKey: string }> {
  onStatus('Creating your private store…');
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    groupName: PERSONAL_GROUP_NAME,
  });

  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: sg.groupId,
    // `is_private: true` — the contract's own flag, and the thing
    // `is_default_private_context` answers on.
    initializationParams: initParamsFor(opts.name ?? 'default', true),
  });

  return {
    groupId: sg.groupId,
    contextId: ctx.contextId,
    memberPublicKey: ctx.memberPublicKey,
  };
}

// ── Agreements (subgroup + context) ─────────────────────────────────────────

export interface AgreementRow {
  agreementId: string;
  name: string;
  /** Null while the agreement exists but has not replicated to this node. */
  contextId: string | null;
  memberCount: number;
  joined: boolean;
  identity: string | null;
}

async function ownedIdentity(
  admin: AdminLike,
  contextId: string,
): Promise<string | null> {
  const res = await admin
    .getContextIdentitiesOwned(contextId)
    .catch(() => null);
  return res?.identities?.[0] ?? null;
}

export async function listAgreements(
  admin: AdminLike,
  namespaceId: string,
): Promise<AgreementRow[]> {
  const subgroups = await admin.listNamespaceGroups(namespaceId);
  return Promise.all(
    (subgroups ?? []).map(async (sg) => {
      const [contexts, members, meta] = await Promise.all([
        admin.listGroupContexts(sg.groupId).catch(() => []),
        admin
          .listGroupMembers(sg.groupId)
          .then((r) => r.members ?? [])
          .catch(() => []),
        admin.getGroupMetadata(sg.groupId).catch(() => null),
      ]);
      const contextId = contexts?.[0]?.contextId ?? null;
      const identity = contextId ? await ownedIdentity(admin, contextId) : null;
      return {
        agreementId: sg.groupId,
        name: displayName([sg.name, meta?.name], sg.groupId, 'Agreement'),
        contextId,
        memberCount: members.length,
        joined: !!identity,
        identity,
      };
    }),
  );
}

/**
 * Create an agreement: subgroup → name → OPEN visibility → its own context.
 *
 * The visibility step is load-bearing and is NOT swallowed: an agreement left
 * restricted cannot be reached by the people invited to sign it, and it fails
 * silently — they get a 403 from `join-via-inheritance` and the UI shows an
 * agreement they can see the name of and never open.
 */
export async function createAgreement(
  admin: AdminLike,
  opts: {
    applicationId: string;
    namespaceId: string;
    name: string;
    isPrivate?: boolean;
  },
  onStatus: StatusFn = noop,
): Promise<{
  agreementId: string;
  contextId: string;
  memberPublicKey: string;
}> {
  onStatus('Creating the agreement…');
  // ⚠️ `groupName`, not `name`: every core request body is
  // `deny_unknown_fields`, so the old spelling is a 400 for the whole call.
  //
  // ⚠️ `visibility` AT BIRTH, not only afterwards. A subgroup with no
  // `visibility` is created RESTRICTED, and between that call and the
  // `setSubgroupVisibility` below there is a window in which an invited signer
  // who tries to enter is refused. Setting it here closes the window; the
  // explicit call is kept because the field is optional in this SDK's request
  // type and a node that ignores it must still end up open.
  const sg = await admin.createGroupInNamespace(opts.namespaceId, {
    groupName: opts.name,
    visibility: 'open',
  });

  onStatus('Naming it…');
  await admin.setGroupMetadata(sg.groupId, { name: opts.name }).catch(() => {});

  onStatus('Opening it to the workspace…');
  await admin.setSubgroupVisibility(sg.groupId, {
    subgroupVisibility: 'open',
  });

  onStatus('Preparing its documents…');
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    // ⚠️ THE SUBGROUP, not the namespace. This is the binding rc.41 requires
    // and the old model had nothing to put here.
    groupId: sg.groupId,
    initializationParams: initParamsFor(opts.name, opts.isPrivate ?? false),
  });

  return {
    agreementId: sg.groupId,
    contextId: ctx.contextId,
    memberPublicKey: ctx.memberPublicKey,
  };
}

/** Enter an agreement's context, joining by inheritance if needed. */
export async function enterAgreement(
  admin: AdminLike,
  opts: { namespaceId: string; agreementId: string; contextId: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  const existing = await ownedIdentity(admin, opts.contextId);
  if (existing) return existing;

  onStatus('Joining the agreement…');
  await admin.joinSubgroupInheritance(opts.agreementId).catch(() => {
    // A 403 here means the subgroup is restricted, which `createAgreement`
    // prevents for anything it makes. Left non-fatal so an older agreement
    // still surfaces the clearer error from the identity read below.
  });

  const identity = await ownedIdentity(admin, opts.contextId);
  if (!identity) {
    throw new Error(
      'This node holds no identity in that agreement. If you were just ' +
        'invited, the workspace may still be replicating — try again shortly.',
    );
  }
  return identity;
}

/**
 * Which agreement an invitation should land you in, out of everything the
 * workspace holds.
 *
 * The invitation may name one — `contextId` in the envelope, which the inviter
 * put there when they shared a specific agreement. It is a HINT and is treated
 * as one: it is only honoured when it matches an agreement that is actually in
 * the workspace, so an edited envelope cannot send a joiner anywhere the
 * invitation did not already grant.
 *
 * With no usable hint, one agreement is unambiguous and is opened. Several is
 * genuinely ambiguous — the workspace screen lists them and the person picks,
 * which is better than opening whichever replicated first.
 */
export function pickInvitedAgreement<T extends { contextId: string | null }>(
  agreements: T[],
  hintedContextId: string | undefined,
): T | null {
  const joinable = agreements.filter((a) => !!a.contextId);
  if (hintedContextId) {
    const hinted = joinable.find((a) => a.contextId === hintedContextId);
    if (hinted) return hinted;
  }
  return joinable.length === 1 ? joinable[0] : null;
}
