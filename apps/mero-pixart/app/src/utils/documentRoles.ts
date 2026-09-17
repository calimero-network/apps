// ── Document roles on the members list ───────────────────────────────────────
//
// Two independent role systems meet on the settings screen:
//
//   * TEAM governance — Admin / Member, from `/groups/{id}/members`, changed
//     through the admin API.
//   * DOCUMENT access — admin / editor / viewer, from the contract's
//     `AccessControl`, enforced at merge.
//
// Both are keyed by ACCOUNT id in this app (a member id IS an account since
// rc.23), so unlike mero-design there is nothing to reconcile between id types.
// What still has to be reconciled is the MEANING: the contract cannot see team
// roles, so promoting someone to Admin grants them nothing on the document and
// they read as Admin while every edit is refused.

/** Document-side roles, in ascending order of authority. */
export type DocumentRole = "viewer" | "editor" | "admin";

/**
 * The document role a member effectively holds.
 *
 * `list_roles` only enumerates members who have opened the document, so an
 * absent entry is not "unknown" — it is a plain viewer, which is exactly what
 * the contract's own `get_role` answers for any account it has never seen.
 * Treating absent as unknown is what made rows render no role at all and hid
 * the controls that would have granted one.
 */
export function effectiveDocumentRole(
  contractRoles: Readonly<Record<string, string>>,
  identity: string,
): DocumentRole {
  const role = contractRoles[identity];
  return role === "admin" || role === "editor" ? role : "viewer";
}

/** True if this member may modify the document. */
export function canEditDocument(
  contractRoles: Readonly<Record<string, string>>,
  identity: string,
): boolean {
  return effectiveDocumentRole(contractRoles, identity) !== "viewer";
}

/** A row of the team roster, which is account-keyed. */
export interface RosterRow {
  identity: string;
  role: string;
}

/**
 * Team admins who do not yet hold document access.
 *
 * The app's rule is that Admin implies edit, and the document is the only place
 * that rule can be enforced, so whoever opens settings as document admin
 * reconciles it. Returns the accounts needing a grant — empty when there is
 * nothing to do, so the common case writes nothing.
 *
 * Note this app CAN grant to a member who has never opened the document: a
 * member id is an account, so `require_account` is a parse rather than a
 * lookup. That is what makes reconciling here safe to do eagerly.
 */
export function adminsMissingDocumentAccess(
  roster: readonly RosterRow[],
  contractRoles: Readonly<Record<string, string>>,
): string[] {
  return roster
    .filter((row) => row.role === "Admin")
    .map((row) => row.identity)
    .filter((identity) => !canEditDocument(contractRoles, identity));
}
