/**
 * What a session opened on Hyperfeed Design's frontend may not do itself, done on
 * the node's consent page instead.
 *
 * A passkey session opened on the app's served origin is bound to its package
 * (`/auth/me`'s `app`), and the node refuses it every organization-wide
 * change: an organization role, removing someone from the organization,
 * leaving it, deleting it. The node's consent page does each of those for the
 * person, with their passkey, on the node's own origin. Creating a team,
 * inviting and joining are the shared dialogs'.
 *
 * The page is a full-page redirect, so what the app was doing is kept in
 * `sessionStorage` ({@link ConsentIntent}) and finished when the page sends
 * the person back (`components/ConsentReturn`). What was decided is read from
 * the node (`resumeConsent`), never from the return URL.
 */
import { consentReturn, type ConsentRequest } from "@calimero-network/mero-js";
import { isFrontendBound } from "@calimero-apps/connect";
import { confirmConsentHandoff } from "@calimero-apps/passkey";

import { getApi } from "./client";
import { nodeBasename } from "../utils/servedByNode";

/** An organization role the consent page can give (the owner aside). */
export type OrgRoleName = "admin" | "member" | "guest";

/** What the app was doing when it sent the person to the consent page. */
export type ConsentIntent =
  | { kind: "setMemberRole"; org: string; account: string; role: OrgRoleName }
  | { kind: "removeMember"; org: string; account: string }
  | { kind: "leaveOrg"; org: string }
  | { kind: "deleteOrg"; org: string };

/** The consent page's request for an intent. */
export type OrgConsentRequest =
  | { kind: "setMemberRole"; subject: { org: string; account: string; role: OrgRoleName }; returnTo: string }
  | { kind: "removeMember"; subject: { org: string; account: string }; returnTo: string }
  | { kind: "leaveOrg"; subject: { org: string }; returnTo: string }
  | { kind: "deleteOrg"; subject: { org: string }; returnTo: string };

/** The node's decision on an organization request. */
export interface OrgConsentResult {
  requestId: string;
  kind: ConsentIntent["kind"];
  status: "pending" | "approved" | "declined";
}

/** Where the intent waits while the person is on the consent page (this tab only). */
export const CONSENT_INTENT_KEY = "mero-design:consent-intent";

/** The intent waiting for the consent page's return, if any. */
export function consentIntent(storage: Pick<Storage, "getItem"> = sessionStorage): ConsentIntent | null {
  try {
    const raw = storage.getItem(CONSENT_INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ConsentIntent> | null;
    return v && typeof v === "object" && typeof v.kind === "string" && typeof v.org === "string"
      ? (v as ConsentIntent)
      : null;
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
export function consentReturnTo(location: Pick<Location, "origin"> = window.location): string {
  return new URL(nodeBasename(), location.origin).toString();
}

/** The consent request for `intent`. */
export function consentRequest(intent: ConsentIntent, returnTo: string = consentReturnTo()): OrgConsentRequest {
  switch (intent.kind) {
    case "setMemberRole":
      return { kind: "setMemberRole", subject: { org: intent.org, account: intent.account, role: intent.role }, returnTo };
    case "removeMember":
      return { kind: "removeMember", subject: { org: intent.org, account: intent.account }, returnTo };
    case "leaveOrg":
      return { kind: "leaveOrg", subject: { org: intent.org }, returnTo };
    case "deleteOrg":
      return { kind: "deleteOrg", subject: { org: intent.org }, returnTo };
  }
}

/** What `intent` asks the node to approve, in the words the person used. */
export function consentAction(intent: ConsentIntent): string {
  switch (intent.kind) {
    case "setMemberRole":
      return intent.role === "admin" ? "Make them an admin of this team" : "Change their role in this team";
    case "removeMember":
      return "Remove them from this team's organization";
    case "leaveOrg":
      return "Leave this team's organization";
    case "deleteOrg":
      return "Delete this team and every board in it";
  }
}

/** Thrown when the person chose not to go to the consent page: nothing was changed. */
export class StayedInApp extends Error {
  constructor() {
    super("Nothing was changed: this needs your approval on your node's page.");
    this.name = "StayedInApp";
  }
}

/**
 * An organization-wide change: on a session bound to the app's frontend,
 * keeps `intent`, sends the person to the consent page (after the handoff
 * dialog with its confirmation code) and never settles while the page
 * unloads. Answers `false` on an unbound session, which makes the change
 * itself. Throws {@link StayedInApp} when the person chose not to go.
 */
export async function askOrgConsent(intent: ConsentIntent): Promise<boolean> {
  const { client, after } = getApi();
  if (!(await isFrontendBound(client))) return false;
  keepIntent(intent);
  let went = false;
  try {
    // The organization kinds are not in mero-js's `ConsentRequest` yet; the node takes them.
    const request: ConsentRequest | OrgConsentRequest = consentRequest(intent);
    await client.openConsentPage(request as ConsentRequest, {
      confirm: async (started) => {
        went = await confirmConsentHandoff({ code: started.code ?? "", action: consentAction(intent) });
        return went;
      },
    });
  } catch (e) {
    forgetConsentIntent();
    throw e;
  } finally {
    after();
  }
  if (!went) {
    forgetConsentIntent();
    throw new StayedInApp();
  }
  // Navigating: nothing more happens on this page.
  return new Promise<boolean>(() => {});
}

// ── coming back ─────────────────────────────────────────────────────────────

let returned: { href: string; intent: ConsentIntent } | null = null;

/**
 * Before the router mounts: the URL the consent page sent the person back
 * to, when this tab kept an intent for it. The root sends a signed-in visitor
 * on, which drops the URL's parameters before the return could be read.
 */
export function captureConsentReturn(href: string = window.location.href): void {
  const intent = consentIntent();
  if (intent && consentReturn(href)) returned = { href, intent };
}

/** Whether {@link captureConsentReturn} kept a return to finish. */
export function hasConsentReturn(): boolean {
  return returned !== null;
}

/** A consent page's return, with what the app was doing when it went. */
export interface ConsentReturned {
  intent: ConsentIntent | null;
  approved: boolean;
}

/**
 * The node's decision on the request this tab sent, with the intent kept for
 * it. `null` when no return was captured. Both are forgotten here; throws
 * what `resumeConsent` throws for a return this tab did not start.
 */
export async function returnFromConsent(): Promise<ConsentReturned | null> {
  const kept = returned;
  if (!kept) return null;
  returned = null;
  forgetConsentIntent();
  const { client, after } = getApi();
  let result: OrgConsentResult | null;
  try {
    result = (await client.resumeConsent({ href: kept.href })) as unknown as OrgConsentResult | null;
  } finally {
    after();
  }
  if (!result) return null;
  return {
    intent: kept.intent.kind === result.kind ? kept.intent : null,
    approved: result.status === "approved",
  };
}

