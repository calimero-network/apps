/**
 * The workspace's organization-wide changes: an organization role, removing
 * someone from the organization, leaving it, renaming it and deleting it.
 *
 * A session bound to Chat's frontend is refused each of them, so it sends the
 * person to the node's consent page (`askOrgConsent`), and `ConsentReturn`
 * finishes the job when the page sends them back. An unbound session (the
 * cluster's own page, a dev node) calls the routes itself, as before.
 *
 * In a shared organization, removing someone and leaving are Chat's own (its
 * app team), which a frontend session may do: those stay here.
 */
import { askOrgConsent, type OrgRoleName } from "./consent";
import {
  chatOnlyIn,
  deleteOrg,
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
 * Takes `account` out of the workspace: out of Chat in a shared organization,
 * else out of the organization.
 */
export async function removeFromWorkspace(org: string, account: string): Promise<"app" | "org"> {
  if (!(await chatOnlyIn(org).catch(() => false))) {
    if (await askOrgConsent({ kind: "removeMember", org, account })) return "org";
  }
  return removeFromChat(org, account);
}

/**
 * The signed-in account leaves the workspace: Chat only in a shared
 * organization (`lastApp` when it was their last app there), else the
 * organization.
 */
export async function leaveWorkspace(org: string): Promise<{ left: "app" | "org"; lastApp: boolean }> {
  if (!(await chatOnlyIn(org).catch(() => false))) {
    if (await askOrgConsent({ kind: "leaveOrg", org })) return { left: "org", lastApp: false };
  }
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
