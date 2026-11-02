// Capability bits under the names this app has always used.
//
// Calimero 1.0's organization capabilities (`ORG_CAPABILITIES`, core's
// `types::caps`) keep v1's `MemberCapabilities` bits 0-8 at the same
// positions, so a mask v1 wrote means the same thing here:
//
// | v1 name                  | 1.0 name           | bit |
// |--------------------------|--------------------|-----|
// | CAN_CREATE_CONTEXT       | CREATE_APP         | 0   |
// | CAN_INVITE_MEMBERS       | INVITE_MEMBERS     | 1   |
// | CAN_JOIN_OPEN_SUBGROUPS  | JOIN_OPEN_TEAMS    | 2   |
// | MANAGE_MEMBERS           | MANAGE_MEMBERS     | 3   |
// | MANAGE_APPLICATION       | MANAGE_APPLICATION | 4   |
// | CAN_CREATE_SUBGROUP      | CREATE_TEAM        | 5   |
// | CAN_DELETE_SUBGROUP      | DELETE_TEAM        | 6   |
// | CAN_MANAGE_VISIBILITY    | MANAGE_VISIBILITY  | 7   |
// | CAN_MANAGE_METADATA      | MANAGE_METADATA    | 8   |

import { ORG_CAPABILITIES } from '@calimero-network/mero-js';

export const CAPABILITIES = {
  CAN_CREATE_CONTEXT: ORG_CAPABILITIES.CREATE_APP,
  CAN_INVITE_MEMBERS: ORG_CAPABILITIES.INVITE_MEMBERS,
  CAN_JOIN_OPEN_SUBGROUPS: ORG_CAPABILITIES.JOIN_OPEN_TEAMS,
  MANAGE_MEMBERS: ORG_CAPABILITIES.MANAGE_MEMBERS,
  MANAGE_APPLICATION: ORG_CAPABILITIES.MANAGE_APPLICATION,
  CAN_CREATE_SUBGROUP: ORG_CAPABILITIES.CREATE_TEAM,
  CAN_DELETE_SUBGROUP: ORG_CAPABILITIES.DELETE_TEAM,
  CAN_MANAGE_VISIBILITY: ORG_CAPABILITIES.MANAGE_VISIBILITY,
  CAN_MANAGE_METADATA: ORG_CAPABILITIES.MANAGE_METADATA,
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;
export type CapabilityBit = (typeof CAPABILITIES)[CapabilityName];

/** Whether `mask` has every bit of `cap`. */
export function hasCap(mask: number, cap: number): boolean {
  return ((mask >>> 0) & (cap >>> 0)) === cap >>> 0;
}

export function withCap(mask: number, cap: number): number {
  return (mask | cap) >>> 0;
}

export function withoutCap(mask: number, cap: number): number {
  return (mask & ~cap) >>> 0;
}
