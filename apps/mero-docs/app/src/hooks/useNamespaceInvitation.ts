// Invitations into a workspace or one folder, on Calimero 1.0's org invites.
//
// v1 minted a signed group invitation, carried it in the link as a base64 JSON
// payload, and the joiner's node joined the namespace or the subgroup with it.
// Here an invitation is an org invite token, made and redeemed through the
// shared dialogs: a workspace invite makes the joiner a member of the org, a
// folder invite does that and gives them a row in the folder's team, so they
// reach the folder whether or not it is Restricted. The link is this
// frontend's own URL with the token in its fragment; the token is redeemed
// after sign-in, once the person says yes (InvitationPrompt).

import {
  createInviteStore,
  describeRedeemFailure,
  inviteLinkBase as sharedInviteLinkBase,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite as SharedPendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename, nodeUrl } from '@/lib/servedByNode';

export type InviteKind = 'namespace' | 'group';

/** A link opened with an invitation in it. */
export interface PendingInvite {
  token: string;
  kind: InviteKind;
  /** The workspace for a workspace invite, the folder for a folder invite. */
  targetId: string | null;
  /** The workspace the invite is into, when the link names it. */
  workspaceId: string | null;
  targetName?: string;
}

const LEGACY_PENDING_KEY = 'mero-docs:pending-invite';
/** "Not now" on the invitation page, for the rest of this tab. */
const DEFERRED_KEY = 'mero-docs:invite-deferred';

/**
 * This app's pending invite (`@calimero-apps/connect`). A link names the
 * workspace (`org`) and, for a folder invite, the folder (`team`); `kind` and
 * `name` are the app's own. Links minted before the shared store said `ws` and
 * `folder`, which are kept too, so those still open what they named.
 */
export const invites = createInviteStore('mero-docs', { keep: ['kind', 'name', 'ws', 'folder'] });

/**
 * The page an invite link opens, naming what it points at; the shared dialog
 * adds the token in the fragment. It stays under the served `/{version}/`
 * root until every cluster's served-host redirect keeps the query string
 * (core's served-redirect fix).
 */
export function inviteLinkBase(
  kind: InviteKind,
  ids: { workspace: string; folder?: string },
  name?: string,
): string {
  const root = new URL(nodeUrl('/'));
  return sharedInviteLinkBase({
    org: ids.workspace,
    team: ids.folder,
    extra: { kind, name },
    root: root.pathname,
    origin: root.origin,
  });
}

/** The app's view of a pending invite: what kind, into which workspace and folder. */
export function docsInvite(pending: SharedPendingInvite | null): PendingInvite | null {
  if (!pending) return null;
  const kind: InviteKind = pending.extra.kind === 'group' ? 'group' : 'namespace';
  const workspaceId = pending.org ?? pending.extra.ws ?? null;
  const folder = pending.team ?? pending.extra.folder ?? null;
  return {
    token: pending.token,
    kind,
    targetId: kind === 'group' ? folder : workspaceId,
    workspaceId,
    targetName: pending.extra.name,
  };
}

/**
 * Takes an invitation off the address bar into the store before anything
 * renders: a person opening a link is usually not signed in yet, and the
 * token has to survive the passkey sign-in. A new link undoes "Not now".
 */
export function captureInvite(loc: Pick<Location, 'href'> = window.location): void {
  migrateLegacyInvite();
  if (invites.capture(loc, { basename: nodeBasename() })) dropDeferral();
}

/**
 * Moves an invite an earlier build stored under its own key into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING_KEY);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING_KEY);
    const old = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof old.token !== 'string' || !old.token) return;
    const kind: InviteKind = old.kind === 'group' ? 'group' : 'namespace';
    const extra: Record<string, string> = { kind };
    if (typeof old.targetName === 'string' && old.targetName) extra.name = old.targetName;
    into.put({
      token: old.token,
      org: typeof old.workspaceId === 'string' ? old.workspaceId : null,
      team: kind === 'group' && typeof old.targetId === 'string' ? old.targetId : null,
      doc: null,
      route: null,
      extra,
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

export function pendingInvite(): PendingInvite | null {
  return docsInvite(invites.pending());
}

export function dropInvite(): void {
  invites.drop();
  dropDeferral();
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in: the workspace it joined and, for a folder invite, the folder.
 * InvitationPrompt (inside the router, which the session is not) takes it
 * once signed in and opens that; the front door waits for it.
 */
let joinedAtSignUp: { workspace: string | null; folder: string | null } | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`: remember what the link pointed at. */
export function noteJoinedAtSignUp({ org }: { org: string | null }, pending: SharedPendingInvite | null): void {
  const invite = docsInvite(pending);
  joinedAtSignUp = {
    workspace: org ?? invite?.workspaceId ?? null,
    folder: invite?.kind === 'group' ? invite.targetId : null,
  };
}

/** Whether a sign-up just joined with the invite and what it named is still to open. */
export function joinedAtSignUpPending(): boolean {
  return joinedAtSignUp !== null;
}

/** What a sign-up that just joined with the invite should open, once; `null` when none did. */
export function takeJoinedAtSignUp(): { workspace: string | null; folder: string | null } | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined;
}

/**
 * "Not now" on the invitation page: the ordinary landing page for the rest of
 * this tab, with the token KEPT, so signing in later still offers it.
 */
export function deferInvite(storage: Pick<Storage, 'setItem'> = sessionStorage): void {
  try {
    storage.setItem(DEFERRED_KEY, '1');
  } catch {
    /* the page still moves on for this render */
  }
}

export function inviteDeferred(storage: Pick<Storage, 'getItem'> = sessionStorage): boolean {
  try {
    return storage.getItem(DEFERRED_KEY) === '1';
  } catch {
    return false;
  }
}

function dropDeferral(storage: Pick<Storage, 'removeItem'> = sessionStorage): void {
  try {
    storage.removeItem(DEFERRED_KEY);
  } catch {
    /* nothing stored */
  }
}

/** What an invitation is into, in words: a workspace or one folder. */
export const inviteScope = (invite: Pick<PendingInvite, 'kind'>): 'workspace' | 'folder' =>
  invite.kind === 'namespace' ? 'workspace' : 'folder';

/**
 * What a failed redemption says: a spent invite plainly, anything else (a
 * lapsed session, a rate limit, the cluster unreachable) as worth another try.
 */
export function inviteFailure(cause: unknown): string {
  return describeRedeemFailure(cause);
}
