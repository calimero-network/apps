import { describe, it, expect } from 'vitest';
import { can, Action } from '../policyTable';
import { CAP } from '../../constants/config';

describe('policyTable', () => {
  it('WRITE allows create/edit doc', () => {
    expect(can(CAP.WRITE, Action.CreateDoc)).toBe(true);
    expect(can(CAP.READ, Action.CreateDoc)).toBe(false);
  });

  it('CREATE_GROUP allows create subfolder', () => {
    expect(can(CAP.CREATE_GROUP, Action.CreateSubfolder)).toBe(true);
  });

  it('MANAGE_GROUP gates rename + visibility + delete', () => {
    expect(can(CAP.MANAGE_GROUP, Action.RenameFolder)).toBe(true);
    expect(can(CAP.MANAGE_GROUP, Action.ChangeVisibility)).toBe(true);
    expect(can(CAP.MANAGE_GROUP, Action.DeleteFolder)).toBe(true);
  });

  it('INVITE_MEMBERS vs MANAGE_MEMBERS split', () => {
    expect(can(CAP.INVITE_MEMBERS, Action.AddMember)).toBe(true);
    expect(can(CAP.INVITE_MEMBERS, Action.RemoveMember)).toBe(false);
    expect(can(CAP.MANAGE_MEMBERS, Action.RemoveMember)).toBe(true);
  });

  it('combined bitmask unions', () => {
    expect(can(CAP.READ | CAP.WRITE, Action.CreateDoc)).toBe(true);
  });
});
