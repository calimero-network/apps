// ── Namespaces, spreadsheets, invitations ────────────────────────────────────
//
// The model, with the vocabulary kept straight:
//
//   Namespace  = the shared workspace          ← you invite people HERE
//     └── Context = one spreadsheet
//     └── Context = one spreadsheet
//
// mero-sheets binds each spreadsheet's context directly to the namespace root
// rather than to a subgroup, so there is exactly one membership to grant and a
// namespace invitation covers every spreadsheet in it. That is worth saying out
// loud in the UI, and this module's callers do.
//
// Extracted from `useWorkspace` because these are multi-call sequences with
// retries and fallbacks in them, they are the part most likely to need a fix,
// and a hook is the worst place to unit-test one.

import type { MeroJs } from '@calimero-network/mero-js';
import {
  encodeInvite,
  namespaceIdOfInvite,
  type InviteChainEntry,
  type SheetsInvitePayload,
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

/**
 * Members can create per-namespace contexts and invite others. Mirrors core's
 * MemberCapabilities bits (CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS).
 */
export const DEFAULT_CAPABILITIES = 1 | 2; // = 3

/** How long to wait for a joined context's identity to land, and how often to look. */
const IDENTITY_TIMEOUT_MS = 30_000;
const IDENTITY_POLL_MS = 1_200;

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
 * A join that is already satisfied is a SUCCESS, not a failure. Re-opening a
 * link, a retry after a timeout, and walking a chain that overlaps memberships
 * you already hold all land here — and every one of them should end with the
 * user inside, rather than staring at "already a member" styled as an error.
 */
export function isAlreadyMember(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('already a member') ||
    m.includes('already member') ||
    m.includes('already joined') ||
    m.includes('alreadyjoined') ||
    m.includes('duplicate member')
  );
}

// ── Naming ───────────────────────────────────────────────────────────────────

/**
 * A readable name for a namespace, never an id dressed up as one.
 *
 * `Namespace.name` is optional on the wire and was never populated by this app,
 * because `createNamespace` was called without one. It is now, but a namespace
 * created by an older build still has none, so the fallback has to exist and has
 * to look like a fallback.
 */
export function namespaceLabel(
  ns: { namespaceId: string; name?: string },
  appName: string,
): string {
  return (ns.name ?? '').trim() || `${appName} · ${ns.namespaceId.slice(0, 6)}`;
}

/** A readable name for a spreadsheet whose own name has not resolved yet. */
export function spreadsheetFallbackLabel(contextId: string): string {
  return `Untitled · ${contextId.slice(0, 6)}`;
}

// ── Namespace ────────────────────────────────────────────────────────────────

/**
 * The namespace that holds this app's spreadsheets, creating it on first run.
 *
 * `name` is passed to `createNamespace` — a field that exists on
 * `CreateNamespaceRequest` and was simply never filled in, which is why every
 * invitation this app minted described itself with a 64-hex group id.
 */
export async function ensureNamespace(
  admin: AdminLike,
  opts: { applicationId: string; existingNamespaceId: string | null; name: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  if (opts.existingNamespaceId) return opts.existingNamespaceId;

  onStatus('Creating your workspace…');
  // No `upgradePolicy`: mero-js 13 dropped it from CreateNamespaceRequest and
  // every core request body is a closed set, so sending it is a 400 for the
  // whole call rather than an ignored key.
  const ns = await admin.createNamespace({
    applicationId: opts.applicationId,
    name: opts.name,
  });

  onStatus('Granting member capabilities…');
  // ⚠️ NOT SWALLOWED, AND THAT CHANGED AT rc.41.
  //
  // This call used to end `.catch(() => {})`, with the note "a failure here
  // costs invitees their permissions rather than breaking the workspace". That
  // was true while core seeded a new namespace with `CAN_JOIN_OPEN_SUBGROUPS`
  // and nothing else.
  //
  // 0.11.0-rc.41 changed the seed. `initial_default_capabilities` in core's
  // `crates/context/src/handlers/create_group.rs` now returns
  //
  //     CAN_JOIN_OPEN_SUBGROUPS | CAN_AUTHOR_ON_BEHALF
  //
  // for a namespace root (#3969), and rc.41 also publishes it as a governance
  // op so it REPLICATES to every peer (#3974). `CAN_AUTHOR_ON_BEHALF` is write
  // as somebody else — in a shared spreadsheet, edits attributed to a
  // collaborator who did not make them.
  //
  // So the cost of losing this write inverted: it no longer withholds a
  // capability, it GRANTS one, to everyone invited, silently and permanently.
  await admin.setDefaultCapabilities(ns.namespaceId, {
    defaultCapabilities: DEFAULT_CAPABILITIES,
  });

  return ns.namespaceId;
}

// ── Spreadsheets (contexts) ──────────────────────────────────────────────────

export interface SpreadsheetRow {
  contextId: string;
  name: string;
  /** True when this row's name is a placeholder, not something anyone typed. */
  unnamed: boolean;
}

/**
 * Every spreadsheet in the namespace, by name.
 *
 * Names come from the node, not from `localStorage`. The previous version kept
 * them in a per-browser map keyed by context id, which meant the creator saw
 * "Q3 Budget" and every single person they invited saw "Workspace 1" — the name
 * was never sent anywhere.
 *
 * Two node-side sources, in order: the context listing's own `name`, and the
 * context's metadata record. The metadata record is the one that survives,
 * because it is a replicated record on the group rather than a label the
 * listing may or may not carry; the listing is preferred when present only
 * because it costs no extra round-trip.
 *
 * A per-context read failure degrades THAT row to a placeholder instead of
 * emptying the list — a context whose metadata has not replicated to this node
 * yet is the normal case right after joining, not an error.
 */
export async function listSpreadsheets(
  admin: AdminLike,
  namespaceId: string,
  contexts: readonly { contextId: string; name?: string }[],
): Promise<SpreadsheetRow[]> {
  return Promise.all(
    contexts.map(async (c) => {
      const listed = (c.name ?? '').trim();
      if (listed) return { contextId: c.contextId, name: listed, unnamed: false };
      const meta = await admin
        .getContextMetadata(namespaceId, c.contextId)
        .catch(() => null);
      const name = (meta?.name ?? '').trim();
      return name
        ? { contextId: c.contextId, name, unnamed: false }
        : {
            contextId: c.contextId,
            name: spreadsheetFallbackLabel(c.contextId),
            unnamed: true,
          };
    }),
  );
}

/**
 * Create one spreadsheet: a context in the namespace, named.
 *
 * The name is written in three places on purpose, and none of them is
 * redundant:
 *
 *   1. `createContext({name})` — the node's own label for the context.
 *   2. the context METADATA record — replicated with the group, so a peer who
 *      joins later can read the name WITHOUT holding an identity in the context.
 *      That is the case the picker has to render, and the only source that
 *      covers it.
 *   3. the contract, via `init_project(name)` — the authoritative title, shown
 *      once the spreadsheet is open. The caller does that step, because it
 *      needs the context's executor identity, which does not exist yet here.
 *
 * Step 2 is best-effort: a nameless spreadsheet still works, and losing the
 * label is not worth failing a created spreadsheet over.
 */
export async function createSpreadsheet(
  admin: AdminLike,
  opts: {
    applicationId: string;
    namespaceId: string;
    name: string;
    serviceName: string;
  },
  onStatus: StatusFn = noop,
): Promise<{ contextId: string; memberPublicKey: string }> {
  onStatus('Creating the spreadsheet…');
  const ctx = await admin.createContext({
    applicationId: opts.applicationId,
    groupId: opts.namespaceId,
    serviceName: opts.serviceName,
    name: opts.name,
    initializationParams: [],
  });

  onStatus('Naming it…');
  await admin
    .setContextMetadata(opts.namespaceId, ctx.contextId, { name: opts.name })
    .catch(() => {});

  return { contextId: ctx.contextId, memberPublicKey: ctx.memberPublicKey };
}

// ── Invitations ──────────────────────────────────────────────────────────────

/**
 * Mint an OPEN namespace invitation and encode it as one shareable code.
 *
 * OPEN means the invitation carries no invitee key, so anyone holding the code
 * can join. Deliberately do NOT pass `inviteePublicKey`: it is silently ignored
 * and misleads the next reader.
 *
 * `recursive` is not passed either. The previous version passed
 * `{recursive: true}`, which changes the RESPONSE SHAPE to `{invitations: […]}`
 * — and there is nothing to recurse into, because this app has no subgroups. It
 * bought a second wire format for zero grant.
 *
 * The names ride ALONGSIDE the signature, not inside it: they steer what the
 * recipient is told and which spreadsheet opens, and they cannot grant
 * anything. The id acted on always comes from inside the signed blob.
 */
export async function mintInvite(
  admin: AdminLike,
  opts: {
    namespaceId: string;
    namespaceName?: string;
    /** The spreadsheet open when Invite was pressed — opened after joining. */
    contextId?: string | null;
    projectName?: string;
  },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Minting an invitation…');
  const res = await admin.createNamespaceInvitation(opts.namespaceId, {});
  const invitation = unwrapInvitation(res);
  if (!invitation) {
    throw new Error('The node returned an invitation with no signature.');
  }
  onStatus('Building the link…');
  return encodeInvite({
    invitation,
    kind: 'namespace',
    groupId: opts.namespaceId,
    groupAlias: opts.namespaceName,
    contextId: opts.contextId ?? undefined,
    projectName: opts.projectName,
  });
}

export interface AcceptedInvite {
  namespaceId: string | null;
  /** Carried by the code as a hint; may not have replicated to this node yet. */
  contextId: string | null;
  projectName?: string;
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
  payload: SheetsInvitePayload,
  onStatus: StatusFn = noop,
): Promise<AcceptedInvite> {
  const result: AcceptedInvite = {
    namespaceId: null,
    contextId: payload.contextId ?? null,
    projectName: payload.projectName,
    namespaceName: payload.groupAlias,
  };

  const steps: InviteChainEntry[] = payload.chain ?? [
    {
      groupId: namespaceIdOfInvite(payload),
      invitation: payload.invitation,
      kind: 'namespace',
    },
  ];

  for (const step of steps) {
    // Trust the signature, not the label: re-read the id from the signed blob.
    const signedId = namespaceIdOfInvite(step.invitation) || step.groupId;
    const label = payload.groupAlias
      ? `“${payload.groupAlias}”`
      : 'the workspace';
    onStatus(`Joining ${label}…`);
    try {
      if (step.kind === 'namespace') {
        await admin.joinNamespace(signedId, {
          invitation: step.invitation as never,
          // The node stores this as the namespace's name for THIS member, so a
          // joiner who arrives via a link ends up with the same label the
          // inviter sees rather than a bare id.
          ...(payload.groupAlias ? { groupName: payload.groupAlias } : {}),
        });
        result.namespaceId = signedId;
      } else {
        await admin.joinGroup({ invitation: step.invitation as never });
      }
    } catch (e) {
      if (!isAlreadyMember(e)) throw e;
      onStatus(`Already in ${label} — continuing…`);
      if (step.kind === 'namespace') result.namespaceId = signedId;
    }
  }

  return result;
}

/**
 * Get an executor identity in a spreadsheet's context, joining it if needed.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 *
 * Opening a spreadsheet used to be "ask for the identity we own here; if there
 * is none, stay on the Opening… screen". For the person who CREATED the
 * spreadsheet there is always one, so it worked. For anyone who joined by
 * invitation there never is: auto-follow carries a context identity only into
 * contexts created AFTER you became a member, and every spreadsheet in a
 * workspace you were invited to predates your invitation by definition. So an
 * invited collaborator could see the spreadsheet in the list, click it, and sit
 * on "Opening workspace…" until they gave up. Nothing errored; nothing ever
 * would have.
 *
 * So: use the identity we hold, otherwise ASK for the context, and only fall
 * back to polling if that request itself fails — which is the transient case
 * (the context has not replicated to this node yet) and the only one worth
 * waiting on.
 */
export async function enterSpreadsheet(
  admin: AdminLike,
  contextId: string,
  onStatus: StatusFn = noop,
): Promise<string> {
  const owned = await admin.getContextIdentitiesOwned(contextId).catch(() => null);
  const existing = owned?.identities?.[0];
  if (existing) return existing;

  onStatus('Joining this spreadsheet…');
  const joined = await admin.joinContext(contextId).catch(() => null);
  if (joined?.memberPublicKey) return joined.memberPublicKey;

  onStatus('Waiting for the spreadsheet to reach your node…');
  const deadline = Date.now() + IDENTITY_TIMEOUT_MS;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    await sleep(IDENTITY_POLL_MS);
    const again = await admin.getContextIdentitiesOwned(contextId).catch(() => null);
    const id = again?.identities?.[0];
    if (id) return id;
    const retry = await admin.joinContext(contextId).catch((e) => {
      lastError = e;
      return null;
    });
    if (retry?.memberPublicKey) return retry.memberPublicKey;
  }

  const detail = lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(
    `This spreadsheet has not reached your node yet${detail}. It replicates from ` +
      'a peer who is online, so try again once someone else has it open.',
  );
}
