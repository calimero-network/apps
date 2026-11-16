/**
 * The workspace's organization-wide changes: an organization role, a member's
 * permissions and the member defaults.
 *
 * A session opened on the app's served origin is bound to its frontend, and
 * the node refuses it every organization-wide call. On such a session each of
 * these goes to the node's consent page (a full-page trip, after the
 * "Approve on your Calimero node" dialog), and {@link finishOrgConsent} says
 * what came of it when the page sends the person back. An unbound session
 * (the cluster's own page, a dev node) makes the call itself, as before.
 *
 * Removing someone and leaving are `workspaces.ts`'s, with these options.
 */
import {
  consentReturn,
  passkeyConfirm,
  setMemberRoleConsent,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  ConsentNotStarted,
  appConsentIntent,
  goToConsent,
  isFrontendBound,
  leavingPage,
  resumeAppConsent,
  setConsentDefaults,
  type ClientRoutes,
  type ConsentClient,
  type ConsentOptions,
  type MaybeMe,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';
import { confirmConsentHandoff } from '@calimero-apps/passkey';

import { APP_NAME, PRODUCT_NAME } from './config';

/** The routes these changes use, and the consent page on a bound session. */
export type OrgClient = ClientRoutes<{ orgs: 'setMember' | 'capabilities' }> & MaybeMe & ConsentClient;

/** An organization role the consent page can give (the owner aside). */
export type OrgRoleName = 'admin' | 'member';

/** Where the consent page sends the person back: this app's root on this origin. */
export function consentReturnTo(location: Pick<Location, 'href' | 'origin'> = window.location): string {
  return new URL(nodeBasename(new URL(location.href), '/'), location.origin).toString();
}

/** The consent options for one change: the handoff dialog, saying what is approved. */
export function consentOptions(action?: string): ConsentOptions {
  return {
    ...(typeof window !== 'undefined' ? { returnTo: consentReturnTo() } : {}),
    confirm: (started) =>
      confirmConsentHandoff({ code: started.code ?? '', appName: PRODUCT_NAME, ...(action ? { action } : {}) }),
  };
}

/** Every org-app call from `@calimero-apps/connect` uses the app's handoff dialog. Once, at start-up. */
export function installConsentDefaults(): void {
  setConsentDefaults(consentOptions());
}

/** The role change waiting for the consent page's return (connect keeps the other kinds). */
const ROLE_INTENT_KEY = `${APP_NAME}:consent-role`;

interface RoleIntent {
  org: string;
  account: string;
  role: OrgRoleName;
}

function readRoleIntent(): RoleIntent | null {
  try {
    const raw = sessionStorage.getItem(ROLE_INTENT_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<RoleIntent> | null) : null;
    return v && typeof v.org === 'string' && typeof v.role === 'string' ? (v as RoleIntent) : null;
  } catch {
    return null;
  }
}

function forgetRoleIntent(): void {
  try {
    sessionStorage.removeItem(ROLE_INTENT_KEY);
  } catch {
    /* nothing kept */
  }
}

/** Gives `account` the organization role `role`. On a bound session, on the consent page. */
export async function setOrgRole(
  client: OrgClient,
  org: string,
  account: string,
  role: OrgRoleName,
  passkey: () => PasskeyProvider,
): Promise<void> {
  if (!(await isFrontendBound(client))) {
    await client.orgs.setMember({ org, account, role }, { confirm: passkeyConfirm(passkey()) });
    return;
  }
  const open = client.openConsentPage;
  if (typeof open !== 'function') throw new Error('this client cannot open the consent page');
  try {
    sessionStorage.setItem(ROLE_INTENT_KEY, JSON.stringify({ org, account, role } satisfies RoleIntent));
  } catch {
    /* no session storage: the return is still read */
  }
  let went = false;
  try {
    await open.call(client, setMemberRoleConsent(org, account, role, consentReturnTo()), {
      confirm: async (started) => {
        went = await confirmConsentHandoff({
          code: started.code ?? '',
          appName: PRODUCT_NAME,
          action: role === 'admin' ? 'Make them an admin of this workspace' : 'Make them a member of this workspace',
        });
        return went;
      },
    });
  } catch (e) {
    forgetRoleIntent();
    throw e;
  }
  if (!went) {
    forgetRoleIntent();
    throw new ConsentNotStarted('setMemberRole');
  }
  return leavingPage<void>();
}

/**
 * Sets a member's capability mask (`account`), or the workspace's member
 * defaults (none). On a bound session, on the consent page.
 */
export async function setOrgCapabilities(
  client: OrgClient,
  org: string,
  capabilities: number,
  passkey: () => PasskeyProvider,
  account?: string,
): Promise<void> {
  if (await isFrontendBound(client)) {
    return goToConsent<void>(
      client,
      account ? { kind: 'setCapabilities', org, account, capabilities } : { kind: 'setCapabilities', org, capabilities },
      consentOptions(account ? 'Change what they can do in this workspace' : 'Change what new members can do'),
    );
  }
  await client.orgs.capabilities(
    account ? { org, capabilities, account } : { org, capabilities },
    { confirm: passkeyConfirm(passkey()) },
  );
}

/** What to tell the person once the consent page sent them back. */
export interface ConsentNotice {
  variant: 'success' | 'info' | 'error';
  description: string;
}

/**
 * On load: what came of a change this tab sent to the consent page, or `null`
 * when the page was not opened by it (or it was another dialog's: creating a
 * workspace, inviting and joining finish their own).
 */
export async function finishOrgConsent(
  client: Pick<CalimeroClient, 'resumeConsent'>,
  href: string = window.location.href,
): Promise<ConsentNotice | null> {
  let back: ReturnType<typeof consentReturn>;
  try {
    back = consentReturn(href);
  } catch {
    return null;
  }
  if (!back) return null;
  const role = readRoleIntent();
  const kept = appConsentIntent();
  const ours = (k: string) => k === 'removeMember' || k === 'leaveOrg' || k === 'setCapabilities';
  if (!role && !(kept && ours(kept.kind))) return null;
  forgetRoleIntent();
  let returned: Awaited<ReturnType<typeof resumeAppConsent>>;
  try {
    returned = await resumeAppConsent(client);
  } catch {
    return { variant: 'error', description: 'This approval did not come from a request made here. Nothing was changed.' };
  }
  if (!returned) return null;
  if (!returned.approved) return { variant: 'info', description: 'Not approved. Nothing was changed.' };
  switch (returned.kind) {
    case 'removeMember':
      return { variant: 'success', description: 'They have been removed from the workspace.' };
    case 'leaveOrg':
      // The workspace list no longer has it, so it is closed on load.
      return { variant: 'success', description: 'You have left the workspace.' };
    case 'setCapabilities':
      return { variant: 'success', description: 'Permissions updated.' };
    case 'other': {
      const kind = (returned.result as { kind?: unknown } | null)?.kind;
      if (kind !== 'setMemberRole') return null;
      return {
        variant: 'success',
        description: role?.role === 'admin' ? 'They are now an admin of this workspace.' : 'Their role has been changed.',
      };
    }
    default:
      return null;
  }
}
