import { isAdminRole, parseMembers } from "@calimero-apps/members";
import { sameAccount } from "@calimero-apps/names";

// ── Am I an admin here? ──────────────────────────────────────────────────────
//
// Decides which destructive control a team or project offers: an Admin deletes
// it, anyone else leaves it. Asked of the group's own member listing, keyed by
// ACCOUNT, which is what `getNodeIdentity().accountId` answers with on a node
// and on an account alike.
//
// A listing that fails, or a session that cannot say who it is, answers
// `false`: offering a Delete the node will refuse is the bug being fixed.

/** The one admin call this reads: structural, so tests can stub it. */
export interface MembersReader {
  listGroupMembers(groupId: string): Promise<unknown>;
}

/** Whether `selfAccount` holds Admin in an already-fetched member listing. */
export function isSelfAdmin(raw: unknown, selfAccount: string | null | undefined): boolean {
  if (!selfAccount) return false;
  return parseMembers(raw).some((m) => sameAccount(m.identity, selfAccount) && isAdminRole(m.role));
}

/** Whether `selfAccount` is an Admin of `groupId`; `false` when it cannot be told. */
export async function selfIsGroupAdmin(
  admin: MembersReader,
  groupId: string,
  selfAccount: string | null | undefined,
): Promise<boolean> {
  if (!groupId || !selfAccount) return false;
  try {
    return isSelfAdmin(await admin.listGroupMembers(groupId), selfAccount);
  } catch {
    return false;
  }
}
