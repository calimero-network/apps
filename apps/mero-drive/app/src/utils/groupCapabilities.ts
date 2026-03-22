/**
 * Group member capability bitmasks — aligned with
 * `calimero_context_config::MemberCapabilities` (Rust `u32`).
 */
export const CAN_CREATE_CONTEXT = 1 << 0;
export const CAN_INVITE_MEMBERS = 1 << 1;
export const CAN_JOIN_OPEN_CONTEXTS = 1 << 2;

export interface MemberCapabilityFlags {
  canCreateContext: boolean;
  canInviteMembers: boolean;
  canJoinOpenContexts: boolean;
}

function normalizeU32(mask: number): number {
  return mask >>> 0;
}

/**
 * Expands an API bitmask into boolean flags (unknown high bits are ignored).
 */
export function decodeMemberCapabilitiesBitmask(mask: number): MemberCapabilityFlags {
  const m = normalizeU32(mask);
  return {
    canCreateContext: (m & CAN_CREATE_CONTEXT) !== 0,
    canInviteMembers: (m & CAN_INVITE_MEMBERS) !== 0,
    canJoinOpenContexts: (m & CAN_JOIN_OPEN_CONTEXTS) !== 0,
  };
}

/**
 * Packs boolean flags into a `u32` bitmask suitable for admin API payloads.
 * Omitted or `undefined` flags are treated as false.
 */
export function encodeMemberCapabilitiesBitmask(
  flags: Partial<MemberCapabilityFlags>,
): number {
  let mask = 0;
  if (flags.canCreateContext) {
    mask |= CAN_CREATE_CONTEXT;
  }
  if (flags.canInviteMembers) {
    mask |= CAN_INVITE_MEMBERS;
  }
  if (flags.canJoinOpenContexts) {
    mask |= CAN_JOIN_OPEN_CONTEXTS;
  }
  return normalizeU32(mask);
}
