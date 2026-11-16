// What a session opened on Docs' own frontend may not do itself, done on the
// node's consent page instead.
//
// Served from its package's frontend origin, Docs' passkey session is bound to
// its package and the node refuses it everything organization-wide: an
// organization role, member defaults and capabilities, removing someone from
// the organization, leaving it and deleting it. The node's consent page does
// each of those for the person, with their passkey, on the node's own origin.
// Creating a workspace, inviting and joining are the shared dialogs'.
//
// The page is a full-page redirect, so what Docs was doing is kept in
// `sessionStorage` (`ConsentIntent`) and finished by `ConsentReturn` when the
// page sends the person back. What the approval did is read from the node's
// sealed result, never from the return URL. An unbound session (the cluster's
// own page, a dev node) makes the calls itself, as before.

import type { CalimeroClient, ConsentRequest } from '@calimero-network/mero-js';
import { isFrontendBound } from '@calimero-apps/connect';
import { confirmConsentHandoff } from '@calimero-apps/passkey';

/** An organization role the consent page can give (the owner aside). */
export type OrgRoleName = 'admin' | 'member' | 'guest';

/** What Docs was doing when it sent the person to the consent page. */
export type ConsentIntent =
  /** A workspace member's role: the organization's. */
  | { kind: 'setMemberRole'; org: string; account: string; role: OrgRoleName }
  /** Member defaults (no `account`) or one member's permissions, organization-wide. */
  | { kind: 'setCapabilities'; org: string; account?: string; capabilities: number }
  /** Removing `account` from the workspace's organization. */
  | { kind: 'removeMember'; org: string; account: string }
  /** The signed-in account leaves the workspace's organization. */
  | { kind: 'leaveOrg'; org: string }
  /** The workspace, its organization and everything in it. */
  | { kind: 'deleteOrg'; org: string };

export type ConsentKind = ConsentIntent['kind'];

/** Where the intent waits while the person is on the consent page (this tab only). */
export const CONSENT_INTENT_KEY = 'mero-docs:consent-intent';

/** The intent waiting for the consent page's return, if any. */
export function consentIntent(
  storage: Pick<Storage, 'getItem'> | undefined = sessionStore(),
): ConsentIntent | null {
  try {
    const raw = storage?.getItem(CONSENT_INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { kind?: unknown; org?: unknown } | null;
    return v && typeof v.kind === 'string' && typeof v.org === 'string' ? (v as ConsentIntent) : null;
  } catch {
    return null;
  }
}

export function forgetConsentIntent(storage: Pick<Storage, 'removeItem'> | undefined = sessionStore()): void {
  try {
    storage?.removeItem(CONSENT_INTENT_KEY);
  } catch {
    /* nothing kept */
  }
}

function keepIntent(intent: ConsentIntent): void {
  try {
    sessionStore()?.setItem(CONSENT_INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* no session storage: the return is still read, not finished here */
  }
}

function sessionStore(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** Where the consent page sends the person back: the page they were on. */
export function consentReturnTo(location: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${location.origin}${location.pathname}`;
}

/**
 * The organization kinds' requests (core's consent page). mero-js types only
 * the release, upgrade and invite kinds so far; these are the node's shapes.
 */
export type OrgConsentRequest =
  | { kind: 'setMemberRole'; subject: { org: string; account: string; role: OrgRoleName }; returnTo: string }
  | {
      kind: 'setCapabilities';
      subject: { org: string; account?: string; capabilities: number };
      returnTo: string;
    }
  | { kind: 'removeMember'; subject: { org: string; account: string }; returnTo: string }
  | { kind: 'leaveOrg' | 'deleteOrg'; subject: { org: string }; returnTo: string };

/** The consent page's request for `intent`. */
export function consentRequest(intent: ConsentIntent, returnTo: string = consentReturnTo()): OrgConsentRequest {
  switch (intent.kind) {
    case 'setMemberRole':
      return { kind: intent.kind, subject: { org: intent.org, account: intent.account, role: intent.role }, returnTo };
    case 'setCapabilities':
      return {
        kind: intent.kind,
        subject: {
          org: intent.org,
          capabilities: intent.capabilities,
          ...(intent.account !== undefined ? { account: intent.account } : {}),
        },
        returnTo,
      };
    case 'removeMember':
      return { kind: intent.kind, subject: { org: intent.org, account: intent.account }, returnTo };
    case 'leaveOrg':
    case 'deleteOrg':
      return { kind: intent.kind, subject: { org: intent.org }, returnTo };
  }
}

/** What `intent` asks the node to approve, in the words the person used. */
export function consentAction(intent: ConsentIntent): string {
  switch (intent.kind) {
    case 'setMemberRole':
      return intent.role === 'admin' ? 'Make them an admin of this workspace' : 'Change their role in this workspace';
    case 'setCapabilities':
      return intent.account ? 'Change their permissions in this workspace' : 'Change what new members can do';
    case 'removeMember':
      return 'Remove them from this workspace';
    case 'leaveOrg':
      return "Leave this workspace's organization";
    case 'deleteOrg':
      return 'Delete this workspace and everything in it';
  }
}

/** The person chose not to go to the consent page: nothing was changed. */
export class StayedInDocs extends Error {
  constructor() {
    super('Nothing was changed: this needs your approval on your node’s page.');
    this.name = 'StayedInDocs';
  }
}

/** Whether `error` is {@link StayedInDocs}: nothing to report. */
export const stayedInDocs = (error: unknown): boolean => error instanceof StayedInDocs;

type ConsentClient = Pick<CalimeroClient, 'openConsentPage'> & Parameters<typeof isFrontendBound>[0];

/**
 * An organization-wide change: on a session bound to Docs' frontend, keeps
 * `intent` and sends the person to the consent page, where it is approved and
 * done, and never settles while the page unloads. Answers `false` for an
 * unbound session, which makes the change itself. Throws {@link StayedInDocs}
 * when the person chose not to go.
 */
export async function askOrgConsent(client: ConsentClient, intent: ConsentIntent): Promise<false> {
  if (!(await isFrontendBound(client))) return false;
  keepIntent(intent);
  let went = false;
  try {
    // The organization kinds are sent as they are; this mero-js types only some.
    const request: ConsentRequest | OrgConsentRequest = consentRequest(intent);
    await client.openConsentPage(request as ConsentRequest, {
      confirm: async (started) => {
        went = await confirmConsentHandoff({ code: started.code ?? '', appName: 'Mero Docs', action: consentAction(intent) });
        return went;
      },
    });
  } catch (e) {
    forgetConsentIntent();
    throw e;
  }
  if (!went) {
    forgetConsentIntent();
    throw new StayedInDocs();
  }
  // Navigating: nothing more happens on this page.
  return new Promise<false>(() => {});
}

/** The consent page's decision, with what Docs was doing when it went. */
export interface ConsentReturned {
  intent: ConsentIntent | null;
  kind: string;
  approved: boolean;
}

/**
 * On load: the decision on the request this tab sent to the consent page, from
 * the node (`resumeConsent`), with the intent kept for it. `null` when this
 * page was not opened by the consent page. The intent is forgotten here.
 */
export async function returnFromConsent(client: Pick<CalimeroClient, 'resumeConsent'>): Promise<ConsentReturned | null> {
  const result = (await client.resumeConsent()) as { kind: string; status: string } | null;
  if (!result) return null;
  const intent = consentIntent();
  forgetConsentIntent();
  return {
    intent: intent && intent.kind === result.kind ? intent : null,
    kind: result.kind,
    approved: result.status === 'approved',
  };
}
