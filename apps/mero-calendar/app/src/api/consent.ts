/**
 * What a session opened on Mero Calendar's frontend may not do itself, done on
 * the node's consent page instead.
 *
 * On Calimero Cloud the app is served from its package's frontend origin, and
 * a passkey session opened there is bound to the package (`/auth/me`'s `app`):
 * the node refuses it organization-wide changes (a team's roles, removing
 * someone from the organization, leaving it, deleting it). The node's consent
 * page does each of them for the person, with their passkey, on the node's own
 * origin. Creating a team and inviting are the shared dialogs'.
 *
 * The page is a full-page redirect, so what the app was doing is kept in
 * `sessionStorage` ({@link ConsentIntent}) and finished when the page sends the
 * person back ({@link returnFromConsent}, run by `ConsentReturn`). The decision
 * is read from the node (`resumeConsent`), never from the return URL.
 */
import {
  consentReturn,
  deleteOrgConsent,
  leaveOrgConsent,
  removeMemberConsent,
  setMemberRoleConsent,
  withoutConsentReturn,
  type CalimeroClient,
  type ConsentRequest,
  type ConsentResult,
} from "@calimero-network/mero-js";
import { isFrontendBound, type MaybeMe } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { confirmConsentHandoff } from "@calimero-apps/passkey";

import { APP } from "./session";

const PRODUCT_NAME = "Mero Calendar";

/** The two roles the members panel moves people between. */
export type TeamRoleName = "admin" | "member";

/** What the app was doing when it sent the person to the consent page. `name` is what the screens called them. */
export type ConsentIntent =
  | { kind: "setMemberRole"; org: string; account: string; role: TeamRoleName; name: string }
  | { kind: "removeMember"; org: string; account: string; name: string }
  | { kind: "leaveOrg"; org: string }
  | { kind: "deleteOrg"; org: string };

/** Where the intent waits while the person is on the consent page (this tab only). */
export const CONSENT_INTENT_KEY = `${APP}:consent-intent`;

/**
 * The address this page was opened on, read before anything renders: the
 * front door redirects a signed-in visitor, which drops the consent page's
 * `?request_id=…&result=…` before the return is read.
 */
const LANDED_ON = typeof window !== "undefined" ? window.location.href : "";

/** The intent waiting for the consent page's return, if any. */
export function consentIntent(storage: Pick<Storage, "getItem"> = sessionStorage): ConsentIntent | null {
  try {
    const raw = storage.getItem(CONSENT_INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ConsentIntent> | null;
    return v && typeof v === "object" && typeof v.kind === "string" ? (v as ConsentIntent) : null;
  } catch {
    return null;
  }
}

function keepIntent(intent: ConsentIntent): void {
  try {
    sessionStorage.setItem(CONSENT_INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* no session storage: the return is still read, but not finished here */
  }
}

/** Forget the intent: its return was handled, or it is stale. */
export function forgetConsentIntent(): void {
  try {
    sessionStorage.removeItem(CONSENT_INTENT_KEY);
  } catch {
    /* nothing kept */
  }
}

/** Where the consent page sends the person back: the app's root on this origin. */
export function consentReturnTo(location: Pick<Location, "href" | "origin"> = window.location): string {
  return new URL(nodeBasename(new URL(location.href), "/"), location.origin).toString();
}

/** The consent request for `intent`. */
export function consentRequest(intent: ConsentIntent, returnTo: string = consentReturnTo()): ConsentRequest {
  switch (intent.kind) {
    case "setMemberRole":
      return setMemberRoleConsent(intent.org, intent.account, intent.role, returnTo);
    case "removeMember":
      return removeMemberConsent(intent.org, intent.account, returnTo);
    case "leaveOrg":
      return leaveOrgConsent(intent.org, returnTo);
    case "deleteOrg":
      return deleteOrgConsent(intent.org, returnTo);
  }
}

/** What `intent` asks the node to approve, in the words the screens use. */
export function consentAction(intent: ConsentIntent): string {
  switch (intent.kind) {
    case "setMemberRole":
      return intent.role === "admin" ? `Make ${intent.name} an admin of this team` : `Make ${intent.name} a member again`;
    case "removeMember":
      return `Remove ${intent.name} from this team`;
    case "leaveOrg":
      return "Leave this team";
    case "deleteOrg":
      return "Delete this team and its calendars";
  }
}

/** The person chose not to go to the consent page: nothing was changed. */
export class StayedInApp extends Error {
  constructor() {
    super("Nothing was changed: this needs your approval on your node's page.");
    this.name = "StayedInApp";
  }
}

/**
 * An organization-wide change from a session bound to the app's frontend:
 * keeps `intent` and sends the person to the consent page, where it is
 * approved and done; the promise then never settles while the page unloads.
 * Answers `false` for an unbound session, which makes the change itself.
 * Throws {@link StayedInApp} when the person chose not to go.
 */
export async function askOrgConsent(
  client: MaybeMe & Pick<CalimeroClient, "openConsentPage">,
  intent: ConsentIntent,
): Promise<boolean> {
  if (!(await isFrontendBound(client))) return false;
  keepIntent(intent);
  let went = false;
  try {
    await client.openConsentPage(consentRequest(intent), {
      confirm: async (started) => {
        went = await confirmConsentHandoff({
          code: started.code ?? "",
          appName: PRODUCT_NAME,
          action: consentAction(intent),
        });
        return went;
      },
    });
  } catch (e) {
    forgetConsentIntent();
    throw e;
  }
  if (!went) {
    forgetConsentIntent();
    throw new StayedInApp();
  }
  // Navigating: nothing more happens on this page.
  return new Promise<boolean>(() => {});
}

/** Whether this page is the consent page's return for an intent this tab kept. */
export function consentReturnPending(): boolean {
  return consentReturn(LANDED_ON) !== null && consentIntent() !== null;
}

/** A consent page's return, with what the app was doing when it went. */
export interface ConsentReturned {
  intent: ConsentIntent | null;
  result: ConsentResult;
}

/**
 * On load: the decision on the request this tab sent to the consent page,
 * from the node, with the intent kept for it. `null` when this page was not
 * opened by the consent page. The intent is forgotten here.
 */
export async function returnFromConsent(
  client: Pick<CalimeroClient, "resumeConsent">,
  href: string = LANDED_ON,
): Promise<ConsentReturned | null> {
  try {
    const result = await client.resumeConsent({ href });
    if (!result) return null;
    const intent = consentIntent();
    return { intent: intent && intent.kind === result.kind ? intent : null, result };
  } finally {
    forgetConsentIntent();
    if (typeof window !== "undefined" && consentReturn(window.location.href)) {
      window.history.replaceState(window.history.state, "", withoutConsentReturn(window.location.href));
    }
  }
}
