import { describe, it, expect } from 'vitest';
import {
  CAN_CREATE_CONTEXT,
  CAN_INVITE_MEMBERS,
  CAN_JOIN_OPEN_CONTEXTS,
  decodeMemberCapabilitiesBitmask,
  encodeMemberCapabilitiesBitmask,
} from './groupCapabilities';

describe('member capability bitmask constants', () => {
  it('matches Rust MemberCapabilities bit layout', () => {
    expect(CAN_CREATE_CONTEXT).toBe(1);
    expect(CAN_INVITE_MEMBERS).toBe(2);
    expect(CAN_JOIN_OPEN_CONTEXTS).toBe(4);
  });
});

describe('decodeMemberCapabilitiesBitmask', () => {
  it('decodes zero as all false', () => {
    expect(decodeMemberCapabilitiesBitmask(0)).toEqual({
      canCreateContext: false,
      canInviteMembers: false,
      canJoinOpenContexts: false,
    });
  });

  it('decodes each single bit', () => {
    expect(decodeMemberCapabilitiesBitmask(CAN_CREATE_CONTEXT)).toEqual({
      canCreateContext: true,
      canInviteMembers: false,
      canJoinOpenContexts: false,
    });
    expect(decodeMemberCapabilitiesBitmask(CAN_INVITE_MEMBERS)).toEqual({
      canCreateContext: false,
      canInviteMembers: true,
      canJoinOpenContexts: false,
    });
    expect(decodeMemberCapabilitiesBitmask(CAN_JOIN_OPEN_CONTEXTS)).toEqual({
      canCreateContext: false,
      canInviteMembers: false,
      canJoinOpenContexts: true,
    });
  });

  it('decodes combined bits', () => {
    const all =
      CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS | CAN_JOIN_OPEN_CONTEXTS;
    expect(decodeMemberCapabilitiesBitmask(all)).toEqual({
      canCreateContext: true,
      canInviteMembers: true,
      canJoinOpenContexts: true,
    });
  });

  it('normalizes negative inputs to unsigned 32-bit before decoding', () => {
    const mask = -1 >>> 0;
    expect(decodeMemberCapabilitiesBitmask(mask)).toEqual({
      canCreateContext: true,
      canInviteMembers: true,
      canJoinOpenContexts: true,
    });
  });
});

describe('encodeMemberCapabilitiesBitmask', () => {
  it('encodes empty / all false as 0', () => {
    expect(encodeMemberCapabilitiesBitmask({})).toBe(0);
    expect(
      encodeMemberCapabilitiesBitmask({
        canCreateContext: false,
        canInviteMembers: false,
        canJoinOpenContexts: false,
      }),
    ).toBe(0);
  });

  it('encodes each flag to the correct bit', () => {
    expect(encodeMemberCapabilitiesBitmask({ canCreateContext: true })).toBe(
      CAN_CREATE_CONTEXT,
    );
    expect(encodeMemberCapabilitiesBitmask({ canInviteMembers: true })).toBe(
      CAN_INVITE_MEMBERS,
    );
    expect(
      encodeMemberCapabilitiesBitmask({ canJoinOpenContexts: true }),
    ).toBe(CAN_JOIN_OPEN_CONTEXTS);
  });

  it('OR-combines multiple true flags', () => {
    expect(
      encodeMemberCapabilitiesBitmask({
        canCreateContext: true,
        canInviteMembers: true,
        canJoinOpenContexts: true,
      }),
    ).toBe(CAN_CREATE_CONTEXT | CAN_INVITE_MEMBERS | CAN_JOIN_OPEN_CONTEXTS);
  });
});

describe('encode ↔ decode round-trip', () => {
  it('round-trips all combinations of the three bits', () => {
    for (let i = 0; i < 8; i++) {
      const decoded = decodeMemberCapabilitiesBitmask(i);
      const encoded = encodeMemberCapabilitiesBitmask(decoded);
      expect(encoded).toBe(i);
      expect(decodeMemberCapabilitiesBitmask(encoded)).toEqual(decoded);
    }
  });
});
