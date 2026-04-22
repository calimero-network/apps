// Capability-bit → user-facing action mapping. Single source of truth
// for permission-gated UI (context menu entries, button `disabled`
// state, etc.). See design spec → Permissions Model → Capability →
// Action Policy Table.
//
// Keep bit assignments in sync with `constants/config.ts::CAP` and with
// core's `calimero-context-config` crate.

import { CAP } from '../constants/config';

export enum Action {
  Read = 'read',
  CreateDoc = 'create_doc',
  EditDoc = 'edit_doc',
  DeleteDoc = 'delete_doc',
  CreateSubfolder = 'create_subfolder',
  RenameFolder = 'rename_folder',
  DeleteFolder = 'delete_folder',
  ChangeVisibility = 'change_visibility',
  AddMember = 'add_member',
  RemoveMember = 'remove_member',
  ChangeMemberCaps = 'change_member_caps',
}

const REQUIRED: Record<Action, number> = {
  [Action.Read]: CAP.READ,
  [Action.CreateDoc]: CAP.WRITE,
  [Action.EditDoc]: CAP.WRITE,
  [Action.DeleteDoc]: CAP.WRITE,
  [Action.CreateSubfolder]: CAP.CREATE_GROUP,
  [Action.RenameFolder]: CAP.MANAGE_GROUP,
  [Action.DeleteFolder]: CAP.MANAGE_GROUP,
  [Action.ChangeVisibility]: CAP.MANAGE_GROUP,
  [Action.AddMember]: CAP.INVITE_MEMBERS,
  [Action.RemoveMember]: CAP.MANAGE_MEMBERS,
  [Action.ChangeMemberCaps]: CAP.MANAGE_MEMBERS,
};

export function can(caps: number, action: Action): boolean {
  return (caps & REQUIRED[action]) === REQUIRED[action];
}
