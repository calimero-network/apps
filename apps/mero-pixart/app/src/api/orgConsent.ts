import {
  deleteOrgConsent,
  passkeyConfirm,
  setMemberRoleConsent,
  type CalimeroClient,
  type ConsentRequest,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import {
  appConsentIntent,
  appTeamIdIn,
  appTeams,
  isFrontendBound,
  removeFromAppTeam,
  resumeAppConsent,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type LeftApp,
} from "@calimero-apps/connect";
import { confirmConsentHandoff } from "@calimero-apps/passkey";
import { nodeBasename } from "@calimero-apps/node-served";

import type { ToastKind } from "../contexts/ToastContext";
import { leaveTeam, PRODUCT_NAME, removeTeamMember } from "./teams";

/**
 * A team's organization-wide changes: an org role and deleting the team.
 *
 * On the app's served origin the session is bound to Mero Pixart's frontend,
 * and the node refuses both. They go to the node's consent page instead,
 * where the person approves them with their passkey; what was being done is
 * kept in this tab (`sessionStorage`) and `ConsentReturn` says how it went
 * when the page sends them back. An unbound session (a dev node) makes the
 * call itself, as before.
 *
 * Removing someone and leaving are Mero Pixart's own wherever the team has
 * the app's team: a row off it, which a bound session may take. A team
 * without one goes through connect, which sends those to the consent page.
 */

/** What Mero Pixart sent the person to the consent page for. */
export type OrgIntent =
  | { kind: "setMemberRole"; org: string; account: string; role: "admin" | "member" }
  | { kind: "deleteOrg"; org: string };

/** Where the intent waits while the person is on the consent page (this tab only). */
export const ORG_INTENT_KEY = "mero-pixart:consent-intent";

/** The intent waiting for the consent page's return, if any. */
export function orgIntent(storage: Pick<Storage, "getItem"> = sessionStorage): OrgIntent | null {
  try {
    const raw = storage.getItem(ORG_INTENT_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<OrgIntent> | null) : null;
    return v && (v.kind === "setMemberRole" || v.kind === "deleteOrg") && typeof v.org === "string"
      ? (v as OrgIntent)
      : null;
  } catch {
    return null;
  }
}

function keep(intent: OrgIntent | null): void {
  try {
    if (intent) sessionStorage.setItem(ORG_INTENT_KEY, JSON.stringify(intent));
    else sessionStorage.removeItem(ORG_INTENT_KEY);
  } catch {
    /* no session storage: the change is still made, only not said on return */
  }
}

/** Where the consent page sends the person back: the app's root on this origin. */
function returnTo(): string {
  const url = new URL(window.location.href);
  return new URL(nodeBasename(url, "/"), url.origin).toString();
}

/** The consent request for `intent`. */
export function orgConsentRequest(intent: OrgIntent, back: string): ConsentRequest {
  return intent.kind === "setMemberRole"
    ? setMemberRoleConsent(intent.org, intent.account, intent.role, back)
    : deleteOrgConsent(intent.org, back);
}

/** What `intent` asks the node to approve, in the words the person used. */
export function orgConsentAction(intent: OrgIntent): string {
  return intent.kind === "setMemberRole"
    ? intent.role === "admin"
      ? "Make them an admin of this team"
      : "Make them a member of this team"
    : "Delete this team and its projects";
}

/** Thrown when the person chose not to go to the consent page: nothing was changed. */
export class StayedHere extends Error {
  constructor() {
    super("Nothing was changed: this needs your approval on your node's page.");
    this.name = "StayedHere";
  }
}

type ConsentCapable = Pick<CalimeroClient, "openConsentPage"> & Partial<ClientRoutes<{ auth: "me" }>>;

/**
 * On a session bound to the app's frontend: keeps `intent` and sends the
 * person to the consent page (after the handoff dialog with its code), and
 * never settles while the page unloads. Answers `false` on an unbound
 * session, which makes the change itself. Throws {@link StayedHere} when the
 * person chose not to go.
 */
export async function askOrgConsent(client: ConsentCapable, intent: OrgIntent): Promise<boolean> {
  if (!(await isFrontendBound(client))) return false;
  keep(intent);
  let went = false;
  try {
    await client.openConsentPage(orgConsentRequest(intent, returnTo()), {
      confirm: async (started) => {
        went = await confirmConsentHandoff({
          code: started.code ?? "",
          appName: PRODUCT_NAME,
          action: orgConsentAction(intent),
        });
        return went;
      },
    });
  } catch (e) {
    keep(null);
    throw e;
  }
  if (!went) {
    keep(null);
    throw new StayedHere();
  }
  return new Promise<boolean>(() => {});
}

type OrgClient = ConsentCapable &
  Pick<CalimeroClient, "session"> &
  ClientRoutes<{ orgs: "get" | "setMember" | "delete" | "teamRemoveMember" | "removeMember" | "appTeamList" }>;

/** Gives `account` the team (org) role `role`. */
export async function setTeamRole(
  client: OrgClient,
  org: string,
  account: string,
  role: "admin" | "member",
  passkey: () => PasskeyProvider,
): Promise<void> {
  if (await askOrgConsent(client, { kind: "setMemberRole", org, account, role })) return;
  await client.orgs.setMember({ org, account, role }, { confirm: passkeyConfirm(passkey()) });
}

/** Deletes the team: its organization and every project in it. */
export async function deleteTeam(client: OrgClient, org: string, passkey: () => PasskeyProvider): Promise<void> {
  if (await askOrgConsent(client, { kind: "deleteOrg", org })) return;
  await client.orgs.delete({ org }, { confirm: passkeyConfirm(passkey()) });
}

/** Mero Pixart's own team in `org`, or `null` (a team made before app teams). */
async function appTeamOf(client: OrgClient, org: string, source: AppSource | null): Promise<string | null> {
  const view = (await client.orgs.get({ org })) as AppOrgView;
  return appTeamIdIn(view, sourcePackage(source));
}

/**
 * Takes `account` out of Mero Pixart in the team: off its app team where the
 * team has one (they stay in the organization), else connect's path.
 */
export async function removeFromTeam(
  client: OrgClient,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<"app" | "org"> {
  if (await appTeamOf(client, org, source).catch(() => null)) {
    await removeFromAppTeam(client, org, source, account, passkey);
    return "app";
  }
  return removeTeamMember(client, org, source, account, passkey);
}

/**
 * The signed-in account leaves Mero Pixart in the team: off its app team
 * where the team has one (`lastApp` set when it was their last app there),
 * else connect's path.
 */
export async function leaveAppTeam(
  client: OrgClient,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self: string,
): Promise<LeftApp> {
  if (await appTeamOf(client, org, source).catch(() => null)) {
    await removeFromAppTeam(client, org, source, self, passkey);
    const after = await appTeams(client, org).catch(() => null);
    return { left: "app", lastApp: !!after && !after.appTeams.some((t) => t.member) };
  }
  return leaveTeam(client, org, source, passkey, self);
}

/** How a consent page's return went, for the screen to say. */
export type OrgReturn =
  | { kind: "refused" }
  | { kind: "declined" }
  | { kind: "setMemberRole"; role: "admin" | "member" | null }
  | { kind: "removeMember" }
  | { kind: "left"; org: string | null }
  | { kind: "deleted"; org: string | null };

/** Whether this tab kept an intent for a consent page's return (its own, or connect's remove and leave). */
export function awaitingOrgReturn(): boolean {
  if (orgIntent()) return true;
  const kept = appConsentIntent();
  return kept?.kind === "removeMember" || kept?.kind === "leaveOrg";
}

/**
 * On load, after the consent page sent the person back to `href`: the node's
 * decision on what this tab asked, read from the node, never from the URL.
 * `null` when this page was not opened by the consent page.
 */
export async function returnFromOrgConsent(
  client: Pick<CalimeroClient, "resumeConsent">,
  href: string,
): Promise<OrgReturn | null> {
  const mine = orgIntent();
  if (mine) {
    keep(null);
    let result;
    try {
      result = await client.resumeConsent({ href });
    } catch {
      return { kind: "refused" };
    }
    if (!result) return null;
    if (result.status !== "approved") return { kind: "declined" };
    if (result.kind === "setMemberRole") {
      return { kind: "setMemberRole", role: mine.kind === "setMemberRole" ? mine.role : null };
    }
    if (result.kind === "deleteOrg") return { kind: "deleted", org: mine.org };
    return null;
  }
  const kept = appConsentIntent();
  let back;
  try {
    back = await resumeAppConsent(client, { href });
  } catch {
    return { kind: "refused" };
  }
  if (!back) return null;
  if (!back.approved) return { kind: "declined" };
  if (back.kind === "removeMember") return { kind: "removeMember" };
  if (back.kind === "leaveOrg") {
    return { kind: "left", org: kept?.kind === "leaveOrg" ? kept.org : null };
  }
  return null;
}

/** What to tell the person about a return. */
export function returnMessage(back: OrgReturn): [string, ToastKind] {
  switch (back.kind) {
    case "refused":
      return ["Nothing was changed: this approval did not come from the request made here.", "error"];
    case "declined":
      return ["Not approved. Nothing was changed.", "info"];
    case "setMemberRole":
      return [
        back.role === "member"
          ? "Admin demoted to member."
          : "Member promoted to admin: they manage the team and edit every document.",
        "success",
      ];
    case "removeMember":
      return ["Member removed from the team.", "success"];
    case "left":
      return ["You left the team.", "success"];
    case "deleted":
      return ["Team deleted.", "success"];
  }
}
