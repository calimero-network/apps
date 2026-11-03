// ── Document roles on the members list ───────────────────────────────────────
//
// Two role systems meet on the settings screen:
//
//   * TEAM roles: owner / admin / member / guest, from the org.
//   * DOCUMENT access: admin (the document's owner) / editor / viewer, from
//     the contract.
//
// Both are keyed by account. They are no longer independent: the contract lets
// the team's owner and admins edit every document of the team (v1's frontend
// granted them the editor role by hand, document by document).

/** Document-side roles, in ascending order of authority. */
export type DocumentRole = "viewer" | "editor" | "admin";

/**
 * The document role a member effectively holds.
 *
 * `list_roles` only enumerates members on the document's roster, so an absent
 * entry is not "unknown": it is what the contract's own `get_role` answers for
 * any account it has not seen, an editor for a team owner or admin and a
 * viewer for anyone else.
 */
export function effectiveDocumentRole(
  contractRoles: Readonly<Record<string, string>>,
  identity: string,
  teamRole?: string,
): DocumentRole {
  const role = contractRoles[identity];
  if (role === "admin" || role === "editor") return role;
  return teamRole === "owner" || teamRole === "admin" ? "editor" : "viewer";
}

/** True if this member may modify the document. */
export function canEditDocument(
  contractRoles: Readonly<Record<string, string>>,
  identity: string,
  teamRole?: string,
): boolean {
  return effectiveDocumentRole(contractRoles, identity, teamRole) !== "viewer";
}
