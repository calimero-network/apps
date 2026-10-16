// ── Who may be removed or demoted ────────────────────────────────────────────
//
// A team with no admin left cannot be governed: nobody can promote, remove,
// invite on its behalf or change its boards' access. Core refuses some of these
// itself, but not with an error anyone would understand, so the settings panel
// checks first and says why.

export interface GuardMember {
  /** The member's ACCOUNT id — what the member listing and the removal take. */
  identity: string;
  role: string;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

const isAdmin = (m: GuardMember) => m.role === "Admin";

/**
 * Whether `target` may leave the admin set (removed, or demoted to member)
 * without leaving the team with none.
 */
export function keepsAnAdmin(members: readonly GuardMember[], target: string): GuardResult {
  const t = members.find((m) => m.identity === target);
  if (!t || !isAdmin(t)) return { ok: true };
  const others = members.filter((m) => isAdmin(m) && m.identity !== target).length;
  return others > 0
    ? { ok: true }
    : { ok: false, reason: "This is the team's last admin. Promote someone else first." };
}

/** Whether `self` may remove `target` from the team. */
export function canRemoveMember(
  members: readonly GuardMember[],
  self: string,
  target: string,
): GuardResult {
  if (!self) return { ok: false, reason: "This node could not say who you are." };
  if (target === self) return { ok: false, reason: "You cannot remove yourself." };
  const me = members.find((m) => m.identity === self);
  if (!me || !isAdmin(me)) return { ok: false, reason: "Only a team admin can remove members." };
  return keepsAnAdmin(members, target);
}
