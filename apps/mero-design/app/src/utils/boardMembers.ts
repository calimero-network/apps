// ── Joining the two member sources on a settings screen ──────────────────────
//
// The settings modal shows one list built from two sources that key on
// DIFFERENT ids:
//
//   * `/groups/{id}/members` — the namespace roster, keyed by ACCOUNT id. This
//     is the authorization subject, and the only id that screen ever holds.
//   * the board contract (`list_roles` / `get_members`) — keyed by the board's
//     MEMBER id. That used to be a device-scoped key; it is now the ACCOUNT
//     too (the device→account table it was resolved through was writable by
//     any member, and so could be poisoned), so `member` and `account` agree.
//
// Since rc.27 both are 64 hex characters, so comparing one to the other is not
// a type error and never throws — it simply never matches. That is exactly how
// this shipped: every row fell back to a raw id instead of the username its
// owner picked, the canvas role badge never rendered, and "make editor" sent an
// account id to a contract that only looked up member keys.
//
// `list_roles` now carries both ids, so the join has something to run on.

/** A row of the contract's `list_roles`. */
export interface ContractRoleRow {
  /** The member's account. */
  member: string;
  role: string;
  /** Authorization subject — the same account as `member`. */
  account?: string | null;
}

/** A row of the contract's `get_members`. */
export interface CanvasMemberRow {
  id: string;
  username: string;
}

export interface IndexedBoardMembers {
  /** Canvas role, keyed by account id. */
  roles: Record<string, string>;
  /** Board username, keyed by account id. */
  names: Record<string, string>;
}

/**
 * Re-key the contract's two member views by account, so a namespace member row
 * can find its board username and canvas role.
 *
 * A row with no `account` (an older contract) is keyed by member id instead
 * of dropped.
 */
/** A row of the namespace roster, which is account-keyed. */
export interface RosterRow {
  identity: string;
  role: string;
}

/**
 * Team admins who do not yet hold canvas access.
 *
 * Team governance and the board's `AccessControl` are separate systems — the
 * contract cannot see namespace roles, so promoting someone to Admin grants
 * them exactly nothing on the canvas. The app's rule is that Admin implies
 * edit, and the board is the only place that rule can be enforced, so whoever
 * opens settings as board admin reconciles it.
 *
 * Returns the accounts needing a grant. Empty when there is nothing to do, so
 * the common case writes nothing.
 */
export function adminsMissingCanvasAccess(
  roster: readonly RosterRow[],
  contractRoles: Readonly<Record<string, string>>,
): string[] {
  return roster
    .filter((row) => row.role === "Admin")
    .map((row) => row.identity)
    .filter((identity) => {
      const role = contractRoles[identity];
      // A member the board has never seen has no row at all; granting would
      // fail ("hasn't opened this board yet") and there is nothing to enforce
      // against until they show up.
      if (role === undefined) return false;
      return role !== "admin" && role !== "editor";
    });
}

export function indexBoardMembers(
  roles: readonly ContractRoleRow[],
  members: readonly CanvasMemberRow[],
): IndexedBoardMembers {
  const nameByMember = new Map(members.map((m) => [m.id, m.username]));
  const out: IndexedBoardMembers = { roles: {}, names: {} };

  for (const row of roles) {
    if (!row?.member) continue;
    const key = row.account || row.member;
    out.roles[key] = row.role;
    const username = nameByMember.get(row.member)?.trim();
    if (username) out.names[key] = username;
  }

  return out;
}
