/**
 * The two workspace roles and the rules that decide who may move them.
 *
 * Core's group roles are `Admin`, `Member`, `ReadOnly` and the two TEE roles.
 * A person only ever needs to choose between Admin and Member from a member
 * list; the rest are shown, never offered.
 *
 * The node enforces its own rules and these do not replace them. They exist so
 * the UI refuses the changes that only someone else can undo (the last admin
 * demoting or removing themselves out of the workspace) instead of offering
 * them and reporting a failure afterwards.
 */

export type MemberRole = "Admin" | "Member";

/** The roles a member list offers, in the order it offers them. */
export const MEMBER_ROLES: readonly MemberRole[] = ["Admin", "Member"];

/** A TEE fleet node: infrastructure admitted as a member row, never a person. */
export function isTeeRole(role: string | null | undefined): boolean {
  return role === "ReadOnlyTee" || role === "RelayTee";
}

/** Whether a raw core role is Admin. Case-insensitive: nodes have sent both. */
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").trim().toLowerCase() === "admin";
}

/**
 * The role a raw core role reads as in the Admin/Member choice, or `null` for
 * one that is neither (`ReadOnly`, a TEE role), which the list shows as-is.
 */
export function memberRoleOf(role: string | null | undefined): MemberRole | null {
  const r = (role ?? "").trim().toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "member") return "Member";
  return null;
}

/** How a raw core role is labelled for people. */
export function roleLabel(role: string | null | undefined): string {
  const known = memberRoleOf(role);
  if (known) return known;
  if (role === "ReadOnly") return "Read-only";
  return role?.trim() || "Member";
}

/** How many Admins a member list holds. */
export function countAdmins(members: ReadonlyArray<{ role?: string | null }>): number {
  return members.filter((m) => isAdminRole(m.role)).length;
}

export interface Verdict {
  allowed: boolean;
  /** Why not, phrased for the person looking at the control. */
  reason?: string;
}

export interface RoleChangeInput {
  /** The acting member may manage members (an Admin, or MANAGE_MEMBERS). */
  canManage: boolean;
  /** The row is the acting member's own. */
  isSelf: boolean;
  /** The row's current raw core role. */
  currentRole: string | null | undefined;
  nextRole: MemberRole;
  /** Admins in the workspace now, people only. */
  adminCount: number;
}

export const LAST_ADMIN_REASON =
  "This is the only admin. Make someone else an admin first, or nobody could manage the workspace.";

/**
 * May this role change be offered?
 *
 * Changing your OWN role is allowed while another admin remains: that admin
 * can undo it. Demoting the last admin is not, whoever asks, because nobody
 * would be left who could appoint one again.
 */
export function canChangeRole(input: RoleChangeInput): Verdict {
  const current = memberRoleOf(input.currentRole);
  if (isTeeRole(input.currentRole)) {
    return { allowed: false, reason: "A TEE node's role is set by the network, not here." };
  }
  if (current === input.nextRole) {
    return { allowed: false, reason: `Already ${input.nextRole === "Admin" ? "an admin" : "a member"}.` };
  }
  if (!input.canManage) {
    return { allowed: false, reason: "Only an admin can change roles in this workspace." };
  }
  if (current === "Admin" && input.nextRole !== "Admin" && input.adminCount <= 1) {
    return { allowed: false, reason: LAST_ADMIN_REASON };
  }
  return { allowed: true };
}

export interface RemoveInput {
  canManage: boolean;
  isSelf: boolean;
  /** The row's raw core role. */
  role: string | null | undefined;
  adminCount: number;
}

/**
 * May this member be removed from here?
 *
 * Never yourself: leaving is its own flow in each app, with its own cleanup,
 * and a "remove" on your own row is how the last admin locks a workspace.
 */
export function canRemoveMember(input: RemoveInput): Verdict {
  if (isTeeRole(input.role)) {
    return { allowed: false, reason: "A TEE node is part of the workspace's hosting, not a person." };
  }
  if (input.isSelf) {
    return { allowed: false, reason: "You cannot remove yourself. Leave the workspace instead." };
  }
  if (!input.canManage) {
    return { allowed: false, reason: "Only an admin can remove members." };
  }
  if (isAdminRole(input.role) && input.adminCount <= 1) {
    return { allowed: false, reason: LAST_ADMIN_REASON };
  }
  return { allowed: true };
}
