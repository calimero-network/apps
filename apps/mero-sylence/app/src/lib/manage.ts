import { passkeyConfirm, type CalimeroClient, type ConsentRequest, type PasskeyProvider } from "@calimero-network/mero-js";
import { isFrontendBound, leaveApp, refusedOnFrontend, removeFromApp, type AppSource, type LeftApp } from "@calimero-apps/connect";

/**
 * Managing a workspace's people: an organization role, removing someone, and
 * leaving. The same paths Chat takes. A session opened on Sylence's own
 * frontend may not change the organization itself, so a role change goes
 * through the node's consent page there; removing and leaving go through
 * connect's app path, which picks the app's team or the consent page.
 */

/** The roles a manager can give here. The owner stays the owner. */
export type ManagedRole = "admin" | "member";

/** What a change did: done now, or the person was sent to the node's consent page. */
export type Outcome = "done" | "consent";

function returnTo(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.hash}`;
}

async function roleOnConsentPage(client: CalimeroClient, org: string, account: string, role: ManagedRole): Promise<Outcome> {
  // The node takes the organization kinds; mero-js's request type does not list this one yet.
  const request = { kind: "setMemberRole", subject: { org, account, role }, returnTo: returnTo() } as unknown as ConsentRequest;
  await client.openConsentPage(request);
  return "consent";
}

/** Gives `account` the organization role `role` (owners and admins; one passkey). */
export async function setOrgRole(
  client: CalimeroClient,
  org: string,
  account: string,
  role: ManagedRole,
  passkey: () => PasskeyProvider,
): Promise<Outcome> {
  if (await isFrontendBound(client).catch(() => false)) return roleOnConsentPage(client, org, account, role);
  try {
    await client.orgs.setMember({ org, account, role }, { confirm: passkeyConfirm(passkey()) });
    return "done";
  } catch (e) {
    if (refusedOnFrontend(e)) return roleOnConsentPage(client, org, account, role);
    throw e;
  }
}

/** Takes `account` out of this workspace: off Sylence's team, or out of the organization where it has none. */
export async function removeMember(
  client: CalimeroClient,
  org: string,
  source: AppSource,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<void> {
  await removeFromApp(client, org, source, account, passkey());
}

/** The signed-in account leaves the workspace. */
export async function leaveWorkspace(
  client: CalimeroClient,
  org: string,
  source: AppSource,
  passkey: () => PasskeyProvider,
): Promise<LeftApp> {
  return leaveApp(client, org, source, passkey());
}

/** What a role is called on screen. */
export function roleName(role: string | undefined): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "guest") return "Guest";
  return "Member";
}

/** Owners and admins manage people. */
export function canManage(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Deletes a workspace: this app instance and everything in it, for everyone
 * (core's `DELETE /apps/{app}`: its owner or an admin of its organization).
 * The organization and its other apps stay.
 */
export async function deleteWorkspace(client: Pick<CalimeroClient, "apps">, appId: string): Promise<void> {
  await client.apps.delete({ app: appId });
}

/** Whether `account` may delete `workspace`: its owner, or an owner or admin of its organization. */
export function canDeleteWorkspace(workspace: { owner: string }, account: string, orgRole: string | undefined): boolean {
  return workspace.owner === account || canManage(orgRole);
}
