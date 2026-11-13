/**
 * The workspace's organization-wide changes: an organization role, removing
 * someone from the organization, leaving it, renaming it and deleting it.
 *
 * A session bound to Chat's frontend is refused each of them, so it sends the
 * person to the node's consent page (`askOrgConsent`), and `ConsentReturn`
 * finishes the job when the page sends them back. An unbound session (the
 * cluster's own page, a dev node) calls the routes itself, as before.
 *
 * Removing someone from the workspace and leaving it are Chat's own wherever
 * the workspace has chat's app team: a row off that team, which a frontend
 * session may do without the consent page. Only a workspace without that team
 * (an older one) removes from, or leaves, the organization itself.
 */
import { getAccountId } from "./calimero";
import { askOrgConsent, type OrgRoleName } from "./consent";
import {
  chatOnlyIn,
  deleteOrg,
  hasChatTeam,
  removeFromChatTeam,
  leaveChat,
  leaveChatOrg,
  removeFromChat,
  renameOrg,
  setMemberRole,
} from "./platform";

/** Gives `account` the organization role `role`. */
export async function setOrgRole(org: string, account: string, role: OrgRoleName): Promise<void> {
  if (await askOrgConsent({ kind: "setMemberRole", org, account, role })) return;
  await setMemberRole(org, account, role);
}

/**
 * Takes `account` out of the workspace, which is taking them out of Chat: in a
 * shared organization through connect's app path; elsewhere off chat's app
 * team. A workspace without that team removes them from the organization.
 */
export async function removeFromWorkspace(org: string, account: string): Promise<"app" | "org"> {
  if (await chatOnlyIn(org).catch(() => false)) return removeFromChat(org, account);
  if (await hasChatTeam(org).catch(() => false)) {
    await removeFromChatTeam(org, account);
    return "app";
  }
  if (await askOrgConsent({ kind: "removeMember", org, account })) return "org";
  return removeFromChat(org, account);
}

/**
 * The signed-in account leaves the workspace, which is leaving Chat: in a
 * shared organization through connect (`lastApp` when it was their last app
 * there); elsewhere off chat's app team, where Chat is the organization's app,
 * so `lastApp` is set and the caller offers to leave the organization too. A
 * workspace without that team leaves the organization.
 */
export async function leaveWorkspace(org: string): Promise<{ left: "app" | "org"; lastApp: boolean }> {
  if (await chatOnlyIn(org).catch(() => false)) return leaveChat(org);
  if (await hasChatTeam(org).catch(() => false)) {
    await removeFromChatTeam(org, getAccountId());
    return { left: "app", lastApp: true };
  }
  if (await askOrgConsent({ kind: "leaveOrg", org })) return { left: "org", lastApp: false };
  return leaveChat(org);
}

/** The signed-in account leaves the organization altogether. */
export async function leaveWorkspaceOrg(org: string): Promise<void> {
  if (await askOrgConsent({ kind: "leaveOrg", org })) return;
  await leaveChatOrg(org);
}

/** Renames the workspace: its organization's name. */
export async function renameWorkspace(org: string, name: string): Promise<void> {
  if (await askOrgConsent({ kind: "renameOrg", org, name })) return;
  await renameOrg(org, name);
}

/** Deletes the workspace: its organization and everything in it. */
export async function deleteWorkspace(org: string): Promise<void> {
  if (await askOrgConsent({ kind: "deleteOrg", org })) return;
  await deleteOrg(org);
}
