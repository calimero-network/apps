/**
 * Organization-wide changes from a session bound to Mero Updates' frontend,
 * done on the node's consent page.
 *
 * Served from its own origin, a passkey session is bound to the app's package
 * and the node refuses it organization-wide calls. connect's org-app calls
 * (`removeFromApp`, `leaveApp`, `leaveOrg`) go to the consent page themselves;
 * deleting a company, which connect has no call for, goes through
 * {@link askOrgConsent}. An unbound session (the cluster's own page, a dev
 * node) makes the calls itself, as before.
 *
 * The page is a full-page redirect: what was asked is kept in this tab's
 * `sessionStorage`, and {@link returnFromConsent} reads the node's decision
 * when the page sends the person back.
 */
import {
  consentReturn,
  type CalimeroClient,
  type ConsentRequest,
} from "@calimero-network/mero-js";
import {
  appConsentIntent,
  ConsentNotStarted,
  isFrontendBound,
  resumeAppConsent,
  setConsentDefaults,
  type MaybeMe,
} from "@calimero-apps/connect";
import { confirmConsentHandoff } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP_NAME } from "./config";

/** The app as the handoff dialog names it. */
const PRODUCT_NAME = "Mero Updates";

/** What Mero Updates asked the consent page for, beyond connect's own kinds. */
export type OrgConsentIntent = { kind: "deleteOrg"; org: string; name: string };

/** Where {@link OrgConsentIntent} waits while the person is on the consent page (this tab only). */
export const ORG_CONSENT_KEY = `${APP_NAME}:org-consent-intent`;

/** The companies page, where the consent page sends the person back from deleting a company. */
export function companiesUrl(
  location: Pick<Location, "href"> = window.location,
): string {
  const url = new URL(location.href);
  return new URL(
    "companies",
    new URL(nodeBasename(url, "/"), url.origin),
  ).toString();
}

/** The dialog shown before leaving for the consent page, with the code the page will show. */
function handoff(code: string | undefined, action?: string): Promise<boolean> {
  return confirmConsentHandoff({
    code: code ?? "",
    appName: PRODUCT_NAME,
    ...(action ? { action } : {}),
  });
}

/** connect's org-app calls show the shared handoff dialog before leaving. Once, at start-up. */
export function setupConsent(): void {
  setConsentDefaults({ confirm: (started) => handoff(started.code) });
}

function keep(intent: OrgConsentIntent): void {
  try {
    sessionStorage.setItem(ORG_CONSENT_KEY, JSON.stringify(intent));
  } catch {
    /* no session storage: the return is still read */
  }
}

function kept(): OrgConsentIntent | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(ORG_CONSENT_KEY) ?? "null") as {
      kind?: unknown;
    } | null;
    return v && v.kind === "deleteOrg" ? (v as OrgConsentIntent) : null;
  } catch {
    return null;
  }
}

function forget(): void {
  try {
    sessionStorage.removeItem(ORG_CONSENT_KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * Sends the person to the consent page for `intent` when the session is bound
 * to the app's frontend: answers `false` on an unbound session (make the call
 * here), else never settles while the page unloads. Throws
 * {@link ConsentNotStarted} when the person chose to stay.
 */
export async function askOrgConsent(
  client: MaybeMe & Partial<Pick<CalimeroClient, "openConsentPage">>,
  intent: OrgConsentIntent,
): Promise<boolean> {
  if (!(await isFrontendBound(client))) return false;
  if (typeof client.openConsentPage !== "function") return false;
  const request = {
    kind: intent.kind,
    subject: { org: intent.org },
    returnTo: companiesUrl(),
  };
  keep(intent);
  let went = false;
  try {
    // The organization kinds are not in mero-js's `ConsentRequest` yet; the node takes them.
    await client.openConsentPage(request as unknown as ConsentRequest, {
      confirm: async (started) => {
        went = await handoff(
          started.code,
          `Delete “${intent.name}” and every audience in it`,
        );
        return went;
      },
    });
  } catch (e) {
    forget();
    throw e;
  }
  if (!went) {
    forget();
    throw new ConsentNotStarted(intent.kind);
  }
  return new Promise<boolean>(() => {});
}

/** What the consent page did, when it sent the person back here. */
export interface ConsentOutcome {
  kind: "deleteOrg" | "removeMember" | "leaveOrg";
  approved: boolean;
  org: string | null;
  /** The company's name, for a deletion. */
  name?: string;
}

/**
 * On load: the node's decision on what this tab sent to the consent page,
 * `null` when the page was not opened by it or the return is the shared
 * dialogs' (creating a company, inviting, joining: they resume their own).
 */
export async function returnFromConsent(
  client: Pick<CalimeroClient, "resumeConsent">,
  href: string = window.location.href,
): Promise<ConsentOutcome | null> {
  if (!consentReturn(href)) return null;
  const own = kept();
  if (own) {
    forget();
    const result = (await client.resumeConsent()) as {
      kind?: string;
      status?: string;
    } | null;
    if (!result || result.kind !== own.kind) return null;
    return {
      kind: own.kind,
      approved: result.status === "approved",
      org: own.org,
      name: own.name,
    };
  }
  const intent = appConsentIntent();
  if (intent?.kind !== "removeMember" && intent?.kind !== "leaveOrg")
    return null;
  const back = await resumeAppConsent(client);
  if (!back || (back.kind !== "removeMember" && back.kind !== "leaveOrg"))
    return null;
  return {
    kind: back.kind,
    approved: back.approved,
    org: back.intent?.org ?? null,
  };
}

/** What to tell the person about `outcome`. */
export function consentOutcomeCopy(outcome: ConsentOutcome): string {
  if (!outcome.approved) return "Not approved: nothing was changed.";
  switch (outcome.kind) {
    case "deleteOrg":
      return outcome.name
        ? `Deleted “${outcome.name}”.`
        : "The company was deleted.";
    case "removeMember":
      return "They were removed from the company.";
    case "leaveOrg":
      return "You left the company.";
  }
}
