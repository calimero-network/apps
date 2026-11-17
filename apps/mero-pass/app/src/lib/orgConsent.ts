// A team's organization-wide changes from a session bound to Hyperfeed Pass's
// frontend, on the node's consent page.
//
// On the origin the cluster serves Hyperfeed Pass from, the passkey session is bound
// to Hyperfeed Pass's package and the node refuses organization-wide changes made
// directly: an org role, removing someone from the organization. The node's
// consent page makes them for the person, with their passkey, on its own
// origin. The page is a full-page redirect, so what Hyperfeed Pass was doing is kept
// in `sessionStorage` and said when the page sends the person back
// (`returnFromOrgConsent`). An unbound session (the cluster's own page, a dev
// node) makes the change itself, as before.
//
// Removing someone goes through connect's `removeFromApp`, which starts the
// page itself; `orgConsentOptions` is what it is given, and its return is read
// here too.

import {
  consentReturn,
  setMemberRoleConsent,
  type CalimeroClient,
} from '@calimero-network/mero-js';
import {
  ConsentNotStarted,
  appConsentIntent,
  isFrontendBound,
  resumeAppConsent,
  type ConsentOptions,
  type MaybeMe,
} from '@calimero-apps/connect';
import { confirmConsentHandoff } from '@calimero-apps/passkey';

import type { TeamRole } from './roles';

/** The app as the handoff dialog names it. */
const APP_NAME = 'Hyperfeed Pass';

/** What Hyperfeed Pass was doing when it sent the person to the consent page. */
export interface RoleConsentIntent {
  kind: 'setMemberRole';
  org: string;
  account: string;
  role: TeamRole;
  /** The person's name, for the sentence said on return. */
  name: string;
}

/** Where the intent waits while the person is on the consent page (this tab only). */
export const ORG_CONSENT_KEY = 'mero-pass:consent-intent';

type SessionKV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function session(): SessionKV | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** The intent kept for the consent page's return, if any. */
export function keptRoleIntent(storage = session()): RoleConsentIntent | null {
  try {
    const raw = storage?.getItem(ORG_CONSENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RoleConsentIntent> | null;
    return v?.kind === 'setMemberRole' && v.org && v.account
      ? (v as RoleConsentIntent)
      : null;
  } catch {
    return null;
  }
}

function keep(intent: RoleConsentIntent, storage = session()): void {
  try {
    storage?.setItem(ORG_CONSENT_KEY, JSON.stringify(intent));
  } catch {
    /* no session storage: the change is still made, only not said on return */
  }
}

function forget(storage = session()): void {
  try {
    storage?.removeItem(ORG_CONSENT_KEY);
  } catch {
    /* nothing kept */
  }
}

/** Where the consent page sends the person back: this page, as it is (the People tab). */
export function consentReturnTo(
  location: Pick<Location, 'origin' | 'pathname' | 'search'> = window.location,
): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

/** What the handoff dialog says is being approved. */
export function consentAction(
  intent:
    | { kind: 'setMemberRole'; role: TeamRole; name: string }
    | { kind: 'removeMember'; name: string },
): string {
  if (intent.kind === 'removeMember')
    return `Remove ${intent.name} from this organization`;
  return intent.role === 'admin'
    ? `Make ${intent.name} an Admin of this team`
    : `Make ${intent.name} a Member of this team`;
}

/**
 * The consent options connect's org functions (`removeFromApp`) are given:
 * back to this page, the shared handoff dialog first, and the person's name
 * kept for the sentence on return.
 */
export function orgConsentOptions(name: string): ConsentOptions {
  return {
    returnTo: consentReturnTo(),
    confirm: (started) =>
      confirmConsentHandoff({
        code: started.code ?? '',
        appName: APP_NAME,
        action: consentAction({ kind: 'removeMember', name }),
      }),
    data: { name },
  };
}

/**
 * Gives `intent.account` the org role `intent.role` on the consent page when
 * this session is bound to Hyperfeed Pass's frontend: answers `true` once the page
 * is opening (it then unloads), `false` for an unbound session, which makes
 * the change itself. Throws `ConsentNotStarted` when the person chose to stay.
 */
export async function askRoleConsent(
  client: MaybeMe & Pick<CalimeroClient, 'openConsentPage'>,
  intent: RoleConsentIntent,
): Promise<boolean> {
  if (!(await isFrontendBound(client))) return false;
  keep(intent);
  let went = false;
  try {
    await client.openConsentPage(
      setMemberRoleConsent(
        intent.org,
        intent.account,
        intent.role,
        consentReturnTo(),
      ),
      {
        confirm: async (started) => {
          went = await confirmConsentHandoff({
            code: started.code ?? '',
            appName: APP_NAME,
            action: consentAction(intent),
          });
          return went;
        },
      },
    );
  } catch (e) {
    forget();
    throw e;
  }
  if (!went) {
    forget();
    throw new ConsentNotStarted(intent.kind);
  }
  return true;
}

/** A consent page's return to the People tab, with what was asked. */
export type OrgConsentReturn =
  | {
      kind: 'setMemberRole';
      approved: boolean;
      org: string;
      name: string;
      role: TeamRole;
    }
  | {
      kind: 'removeMember';
      approved: boolean;
      org: string | null;
      name: string;
    };

/**
 * On load: the node's decision on the role change or removal this tab sent to
 * the consent page, read from the node, never from the return URL. `null`
 * when this page was not opened by the consent page, or for a request another
 * screen started (the shared invite and create dialogs resume their own).
 */
export async function returnFromOrgConsent(
  client: Pick<CalimeroClient, 'resumeConsent'>,
  href: string = window.location.href,
): Promise<OrgConsentReturn | null> {
  if (!consentReturn(href)) return null;
  const role = keptRoleIntent();
  if (role) {
    forget();
    const result = await client.resumeConsent();
    if (!result || result.kind !== role.kind) return null;
    return { ...role, approved: result.status === 'approved' };
  }
  const kept = appConsentIntent();
  if (kept?.kind !== 'removeMember') return null;
  const back = await resumeAppConsent(client);
  if (!back || back.kind !== 'removeMember') return null;
  const data = back.intent?.data as { name?: unknown } | undefined;
  return {
    kind: 'removeMember',
    approved: back.approved,
    org: back.intent?.org ?? null,
    name: typeof data?.name === 'string' ? data.name : '',
  };
}
