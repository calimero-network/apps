/**
 * What a session opened on Chat's frontend may not do itself, done on the
 * node's consent page instead.
 *
 * On Calimero Cloud, Chat is served from its package's frontend origin
 * (`{label}.apps.…`), and a passkey session opened there is bound to Chat's
 * package (core#4934): it is refused creating an organization, minting an
 * invite and redeeming one (`403 FORBIDDEN: a session opened on an app's
 * frontend can use that app only; do this on the cluster's own page`). The
 * node's consent page does each of those for the person, with their passkey,
 * on the node's own origin (core#5014): `createOrg`, `createInvite` and
 * `acceptInvite`.
 *
 * The page is a full-page redirect (`client.openConsentPage`), so what Chat
 * was doing is kept in `sessionStorage` ({@link ConsentIntent}) and finished
 * when the page sends the person back ({@link returnFromConsent}, run by
 * `ConsentReturn`). What the approval made (the org, the invite token, the org
 * joined) is read from the node's sealed result, never from the return URL.
 */
import {
  acceptInviteConsent,
  createInviteConsent,
  createOrgConsent,
  type CalimeroClient,
  type ConsentRequest,
  type ConsentResult,
} from "@calimero-network/mero-js";

import { run } from "./platform";
import { nodeBasename } from "../utils/servedByNode";

/** What Chat was doing when it sent the person to the consent page. */
export type ConsentIntent =
  /** "Create workspace": the workspace's name, and the person's own name in it. */
  | { kind: "createOrg"; name: string; selfName: string }
  /** "Invite" in the workspace `org`. */
  | { kind: "createInvite"; org: string }
  /** "Join workspace" for the pending invitation (its token stays where `captureInvite` put it). */
  | { kind: "acceptInvite"; org: string | null };

/** Where the intent waits while the person is on the consent page (this tab only). */
export const CONSENT_INTENT_KEY = "mero-chat:consent-intent";

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

let bound: Promise<boolean> | null = null;

/**
 * Whether this session is bound to Chat's frontend (`/auth/me`'s `app`): then
 * organizations and invites go through the consent page. Asked once per load.
 * A session opened on the cluster's own page, or a dev node's, is unbound and
 * does them itself, as before.
 */
export function frontendBound(): Promise<boolean> {
  bound ??= (async () => {
    try {
      const me = await run((c) => c.auth.me());
      const app = (me as { app?: unknown }).app;
      return typeof app === "string" && app.length > 0;
    } catch {
      // Cannot tell (signed out, a node that does not say): do it here, as before.
      bound = null;
      return false;
    }
  })();
  return bound;
}

/** Whether `error` is the node's refusal of a frontend session (`403`, "an app's frontend"). */
export function refusedOnFrontend(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  const forbidden = e.status === 403 || e.code === 403 || e.code === "FORBIDDEN";
  return forbidden && typeof e.message === "string" && e.message.includes("app's frontend");
}

/** Where the consent page sends the person back: Chat's own root on this origin. */
export function consentReturnTo(location: Pick<Location, "origin"> = window.location): string {
  return new URL(nodeBasename(), location.origin).toString();
}

/** The consent request for `intent` (an invite's terms are given separately). */
export function consentRequest(
  intent: ConsentIntent,
  terms: { inviteToken?: string; inviteTeams?: string[] } = {},
): ConsentRequest {
  const returnTo = consentReturnTo();
  switch (intent.kind) {
    case "createOrg":
      return createOrgConsent(intent.name, returnTo);
    case "createInvite":
      return createInviteConsent({ org: intent.org, role: "member", teams: terms.inviteTeams ?? [] }, returnTo);
    case "acceptInvite":
      return acceptInviteConsent(terms.inviteToken ?? "", returnTo);
  }
}

/**
 * Keeps `intent` and sends the person to the node's consent page for
 * `request`. They first see the confirmation code the page will show, so a
 * page that is not the node's is told apart. Answers `false` when they chose
 * not to go; otherwise the page unloads and this never settles.
 */
export async function askOnConsentPage(intent: ConsentIntent, request: ConsentRequest): Promise<boolean> {
  keepIntent(intent);
  let went = false;
  try {
    await run((c: CalimeroClient) =>
      c.openConsentPage(request, {
        confirm: (started) => {
          went = window.confirm(
            "Your Calimero node will ask you to approve this with your passkey on its own page.\n\n" +
              `Check that the page shows the code ${started.code ?? ""}.`,
          );
          return went;
        },
      }),
    );
  } catch (e) {
    forgetConsentIntent();
    throw e;
  }
  if (!went) {
    forgetConsentIntent();
    return false;
  }
  // Navigating: nothing more happens on this page.
  return new Promise<boolean>(() => {});
}

/** A consent page's return, with what Chat was doing when it went. */
export interface ConsentReturned {
  intent: ConsentIntent | null;
  result: ConsentResult;
}

/**
 * On load: the decision on the request this tab sent to the consent page, from
 * the node (`resumeConsent`), with the intent kept for it. `null` when this
 * page was not opened by the consent page. The intent is forgotten here.
 */
export async function returnFromConsent(): Promise<ConsentReturned | null> {
  const result = await run((c) => c.resumeConsent());
  if (!result) return null;
  const intent = consentIntent();
  forgetConsentIntent();
  return { intent: intent && intent.kind === result.kind ? intent : null, result };
}
