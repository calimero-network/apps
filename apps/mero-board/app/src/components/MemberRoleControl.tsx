import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { ROLE_ADMIN, ROLE_MEMBER, type WorkspaceRole } from '../utils/roles';

interface Props {
  /** The member's ACCOUNT — never a context executor key. */
  account: string;
  role: WorkspaceRole;
  isSelf: boolean;
  /** True when the signed-in member holds MANAGE_MEMBERS (or is an Admin). */
  canManage: boolean;
  busy: boolean;
  onChange: (role: WorkspaceRole) => void;
}

/**
 * Promote / demote one member between Admin and Member.
 *
 * Read-only in three cases, each for a different reason:
 *
 *  - **No permission.** Someone without MANAGE_MEMBERS gets a badge, not a
 *    disabled select. The node would refuse the write anyway, and offering a
 *    control that always fails is worse than not offering one.
 *  - **Yourself.** Demoting yourself is how the last admin locks everybody out
 *    of a workspace permanently — there is no recovery path, because the person
 *    who could grant the role back no longer exists. Changing your own role has
 *    to go through another admin.
 *  - **In flight.** The write is followed by a read-back from the node, so the
 *    control stays disabled until the node has confirmed the new value rather
 *    than flipping optimistically to a state the node may have refused.
 */
export default function MemberRoleControl({
  account,
  role,
  isSelf,
  canManage,
  busy,
  onChange,
}: Props): React.ReactElement {
  const locked = !canManage || isSelf;

  if (locked) {
    return (
      <Badge
        className={role === ROLE_ADMIN ? 'admin' : ''}
        data-testid="member-role-badge"
        data-account={account}
        title={
          isSelf
            ? 'Another admin has to change your role — demoting yourself could leave the workspace with no admin.'
            : 'Only an admin can change roles in this workspace.'
        }
      >
        {role}
      </Badge>
    );
  }

  return (
    <Select
      data-testid="member-role-select"
      data-account={account}
      aria-label="Role"
      value={role}
      disabled={busy}
      onChange={(e) => {
        const next = e.target.value as WorkspaceRole;
        if (next !== role) onChange(next);
      }}
    >
      <option value={ROLE_ADMIN}>{ROLE_ADMIN}</option>
      <option value={ROLE_MEMBER}>{ROLE_MEMBER}</option>
    </Select>
  );
}

const Badge = styled.span`
  display: inline-block; font-size: 11.5px; font-weight: 600; padding: 3px 9px;
  border-radius: 5px; border: 1px solid ${t.color.border};
  background: ${t.color.raised}; color: ${t.color.text2};
  &.admin {
    color: ${t.color.accent};
    border-color: ${t.color.accentBorder};
    background: ${t.color.accentDim};
  }
`;
const Select = styled.select`
  font-family: inherit; font-size: 12px; font-weight: 500; padding: 4px 8px;
  border-radius: ${t.radius}; cursor: pointer;
  background: ${t.color.raised}; color: ${t.color.text};
  border: 1px solid ${t.color.border};
  &:hover:not(:disabled) { background: ${t.color.raised2}; }
  &:disabled { opacity: 0.55; cursor: default; }
`;
