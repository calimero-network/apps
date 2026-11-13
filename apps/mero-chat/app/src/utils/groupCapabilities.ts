// The capabilities on a person's row in Chat's app team (core's bits; a
// workspace without that team reads and writes them org-wide instead).
export const CAN_CREATE_CONTEXT = 1 << 0;
export const CAN_INVITE_MEMBERS = 1 << 1;
export const CAN_JOIN_OPEN_SUBGROUPS = 1 << 2;
export const CAN_DELETE_SUBGROUP = 1 << 6;
export const CAN_MANAGE_VISIBILITY = 1 << 7;
// core's CREATE_CHILD_TEAM: a closed team below Chat's app team, which is
// what a private channel or a DM is. On by default in an app team.
export const CAN_CREATE_SUBGROUP = 1 << 11;

/** The bits the toggles below read and write; a row's other bits are kept as they are. */
export const TOGGLED_CAPABILITIES =
  CAN_CREATE_CONTEXT |
  CAN_INVITE_MEMBERS |
  CAN_JOIN_OPEN_SUBGROUPS |
  CAN_CREATE_SUBGROUP |
  CAN_DELETE_SUBGROUP |
  CAN_MANAGE_VISIBILITY;

export interface GroupCapabilityToggles {
  canCreateContext: boolean;
  canInviteMembers: boolean;
  canJoinOpenSubgroups: boolean;
  canCreateSubgroup: boolean;
  canDeleteSubgroup: boolean;
  canManageVisibility: boolean;
}

export function hasGroupCapability(
  capabilities: number | null | undefined,
  capability: number,
): boolean {
  return typeof capabilities === "number" && (capabilities & capability) === capability;
}

export function buildGroupCapabilitiesMask(
  toggles: GroupCapabilityToggles,
): number {
  let mask = 0;

  if (toggles.canCreateContext) mask |= CAN_CREATE_CONTEXT;
  if (toggles.canInviteMembers) mask |= CAN_INVITE_MEMBERS;
  if (toggles.canJoinOpenSubgroups) mask |= CAN_JOIN_OPEN_SUBGROUPS;
  if (toggles.canCreateSubgroup) mask |= CAN_CREATE_SUBGROUP;
  if (toggles.canDeleteSubgroup) mask |= CAN_DELETE_SUBGROUP;
  if (toggles.canManageVisibility) mask |= CAN_MANAGE_VISIBILITY;

  return mask;
}

export function readGroupCapabilitiesMask(
  capabilities: number | null | undefined,
): GroupCapabilityToggles {
  return {
    canCreateContext: hasGroupCapability(capabilities, CAN_CREATE_CONTEXT),
    canInviteMembers: hasGroupCapability(capabilities, CAN_INVITE_MEMBERS),
    canJoinOpenSubgroups: hasGroupCapability(capabilities, CAN_JOIN_OPEN_SUBGROUPS),
    canCreateSubgroup: hasGroupCapability(capabilities, CAN_CREATE_SUBGROUP),
    canDeleteSubgroup: hasGroupCapability(capabilities, CAN_DELETE_SUBGROUP),
    canManageVisibility: hasGroupCapability(capabilities, CAN_MANAGE_VISIBILITY),
  };
}

export function canInviteWorkspaceMembers(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_INVITE_MEMBERS);
}

export function canCreateGroupContexts(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_CREATE_CONTEXT);
}

export function canJoinOpenSubgroups(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_JOIN_OPEN_SUBGROUPS);
}

export function canCreateSubgroup(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_CREATE_SUBGROUP);
}

export function canDeleteSubgroup(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_DELETE_SUBGROUP);
}

export function canManageVisibility(
  capabilities: number | null | undefined,
): boolean {
  return hasGroupCapability(capabilities, CAN_MANAGE_VISIBILITY);
}
