import React, { useState } from "react";
import styled from "styled-components";
import { IdentityAvatar } from "../IdentityAvatar";
import type { GroupMember, MemberCapabilities } from "../../api/groupApi";
import ConfirmPopup from "../popups/ConfirmPopup";
import {
  canChangeRole,
  canRemoveMember,
  countAdmins,
  type MemberRole,
} from "@calimero-apps/members";
import {
  buildGroupCapabilitiesMask,
  readGroupCapabilitiesMask,
  type GroupCapabilityToggles,
} from "../../utils/groupCapabilities";

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const MemberRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.625rem;
  border-radius: 10px;
  transition: background 0.12s ease;
  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 4%, transparent);
  }
`;

const MemberInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
`;

const Identity = styled.span`
  font-size: 0.8rem;
  color: var(--glass-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
`;

const IdentityStack = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;



const RoleBadge = styled.span<{ $admin: boolean }>`
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.375rem;
  border-radius: 8px;
  background: ${({ $admin }) =>
    $admin ? "rgba(124, 58, 237, 0.15)" : "color-mix(in srgb, var(--glass-ink) 6%, transparent)"};
  color: ${({ $admin }) =>
    $admin ? "var(--chat-violet)" : "color-mix(in srgb, var(--glass-ink) 40%, transparent)"};
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
`;

const SmallButton = styled.button`
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 10%, transparent);
    color: var(--glass-ink);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const RemoveButton = styled(SmallButton)`
  border-color: rgba(239, 68, 68, 0.2);
  color: var(--glass-bad-ink);
  &:hover {
    background: rgba(239, 68, 68, 0.1);
    color: var(--glass-bad-ink);
    border-color: rgba(239, 68, 68, 0.4);
  }
`;

const RoleSelect = styled.select`
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  color: var(--glass-ink);
  font-size: 0.7rem;
  padding: 0.2rem 0.375rem;
  border-radius: 5px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ReadOnlyNote = styled.div`
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);
  padding: 0 0.625rem 0.5rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  font-size: 0.82rem;
`;

const CapabilitiesOverlay = styled.div`
  background: var(--glass-surface-solid);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  border-radius: 10px;
  padding: 0.625rem;
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
`;

const CapLabel = styled.div`
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--glass-ink) 40%, transparent);
  margin-bottom: 0.375rem;
`;

const CapabilitiesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const CapabilityRow = styled.label`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.625rem;
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  border-radius: 5px;
`;

const CapabilityInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
`;

const CapabilityTitle = styled.div`
  color: var(--glass-ink);
  font-size: 0.78rem;
  font-weight: 500;
`;

const CapabilityDescription = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);
  font-size: 0.68rem;
  line-height: 1.4;
`;

const CapabilityToggle = styled.input`
  width: 18px;
  height: 18px;
  accent-color: var(--glass-accent);
  cursor: pointer;
`;

const CapActions = styled.div`
  display: flex;
  gap: 0.375rem;
  margin-top: 0.375rem;
  justify-content: flex-end;
`;


function getMemberDisplayName(member: GroupMember): string {
  // Never leak the raw identity hash as the visible name — show
  // "Unnamed member" until the name metadata propagates from the
  // member's node. The full identity stays available via the row's
  // `title` tooltip and as a confirm-modal argument.
  return member.alias?.trim() || "Unnamed member";
}

interface MembersTabProps {
  groupId: string;
  members: GroupMember[];
  /**
   * The signed-in member is an admin. Without it the list is read-only: the
   * node would refuse every change, and seeing who is in the workspace is
   * useful without the right to change it.
   */
  canManage?: boolean;
  /** The signed-in member's ACCOUNT, to keep controls off their own row. */
  selfIdentity?: string;
  actionLoading: boolean;
  onRemoveMember: (groupId: string, identity: string) => Promise<boolean>;
  onUpdateRole?: (
    groupId: string,
    identity: string,
    role: MemberRole,
  ) => Promise<boolean>;
  onSetCapabilities: (
    groupId: string,
    identity: string,
    capabilities: number,
  ) => Promise<boolean>;
  onGetCapabilities: (
    groupId: string,
    identity: string,
  ) => Promise<MemberCapabilities | null>;
  onRefresh: () => void;
}

export default function MembersTab({
  groupId,
  members,
  canManage = true,
  selfIdentity = "",
  actionLoading,
  onRemoveMember,
  onUpdateRole,
  onSetCapabilities,
  onGetCapabilities,
  onRefresh,
}: MembersTabProps) {
  const [capEditIdentity, setCapEditIdentity] = useState<string | null>(null);
  const [capToggles, setCapToggles] = useState<GroupCapabilityToggles>({
    canCreateContext: false,
    canInviteMembers: false,
    canJoinOpenSubgroups: false,
    canCreateSubgroup: false,
    canDeleteSubgroup: false,
    canManageVisibility: false,
  });
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const openCapabilities = async (identity: string) => {
    const caps = await onGetCapabilities(groupId, identity);
    setCapToggles(readGroupCapabilitiesMask(caps?.capabilities));
    setCapEditIdentity(identity);
  };

  const saveCapabilities = async () => {
    if (!capEditIdentity) return;
    const ok = await onSetCapabilities(
      groupId,
      capEditIdentity,
      buildGroupCapabilitiesMask(capToggles),
    );
    if (ok) setCapEditIdentity(null);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    const ok = await onRemoveMember(groupId, removeTarget);
    if (ok) {
      setRemoveTarget(null);
      onRefresh();
    }
  };

  if (members.length === 0) {
    return <EmptyState>No members found</EmptyState>;
  }

  const adminCount = countAdmins(members);
  const isSelf = (identity: string) =>
    !!selfIdentity && identity.toLowerCase() === selfIdentity.toLowerCase();

  return (
    <List>
      {!canManage && (
        <ReadOnlyNote>Only a workspace admin can change roles or remove people.</ReadOnlyNote>
      )}
      {members.map((member) => {
        const self = isSelf(member.identity);
        const role: MemberRole = member.role === "Admin" ? "Admin" : "Member";
        const otherRole: MemberRole = role === "Admin" ? "Member" : "Admin";
        // Your own role is changed by another admin: stepping down from here
        // is how the last admin locks a workspace, and the guard below only
        // counts the admins this list can see.
        const roleChange = self
          ? { allowed: false, reason: "Another admin has to change your role." }
          : canChangeRole({
              canManage,
              isSelf: self,
              currentRole: member.role,
              nextRole: otherRole,
              adminCount,
            });
        const removal = canRemoveMember({
          canManage,
          isSelf: self,
          role: member.role,
          adminCount,
        });
        const choosable =
          canManage && !!onUpdateRole && (member.role === "Admin" || member.role === "Member");
        return (
        <React.Fragment key={member.identity}>
          <MemberRow>
            <MemberInfo>
              <IdentityAvatar size="xs" identity={member.identity} name={getMemberDisplayName(member)} />
              <IdentityStack>
                <Identity title={member.identity}>
                  {getMemberDisplayName(member)}
                </Identity>
              </IdentityStack>
              {!choosable && (
                <RoleBadge $admin={member.role === "Admin"}>
                  {member.role}
                </RoleBadge>
              )}
            </MemberInfo>
            <Actions>
              {choosable && (
                <RoleSelect
                  aria-label={`Role for ${getMemberDisplayName(member)}`}
                  value={role}
                  disabled={actionLoading || !roleChange.allowed}
                  title={roleChange.allowed ? undefined : roleChange.reason}
                  onChange={(e) => {
                    const next = e.target.value as MemberRole;
                    if (next !== role) void onUpdateRole?.(groupId, member.identity, next);
                  }}
                >
                  <option value="Admin">Admin</option>
                  <option value="Member">Member</option>
                </RoleSelect>
              )}
              {canManage && member.role !== "Admin" && (
                <SmallButton
                  onClick={() => openCapabilities(member.identity)}
                  disabled={actionLoading}
                >
                  Capabilities
                </SmallButton>
              )}
              {removal.allowed && (
                <ConfirmPopup
                  title="Remove Member"
                  message={`Remove ${getMemberDisplayName(member)} from the group? This will revoke access to all group contexts (cascade removal).`}
                  confirmLabel="Remove"
                  onConfirm={handleRemove}
                  toggle={
                    <RemoveButton
                      onClick={() => setRemoveTarget(member.identity)}
                      disabled={actionLoading}
                    >
                      Remove
                    </RemoveButton>
                  }
                  isOpen={confirmRemoveOpen && removeTarget === member.identity}
                  setIsOpen={(open) => {
                    setConfirmRemoveOpen(open);
                    if (!open) setRemoveTarget(null);
                  }}
                  isChild
                />
              )}
            </Actions>
          </MemberRow>

          {canManage && member.role !== "Admin" && capEditIdentity === member.identity && (
            <CapabilitiesOverlay>
              <CapLabel>
                Member permissions for {getMemberDisplayName(member)}
              </CapLabel>
              <CapabilitiesList>
                <CapabilityRow>
                  <CapabilityInfo>
                    <CapabilityTitle>Create channels</CapabilityTitle>
                    <CapabilityDescription>
                      Allow this member to create new channels (root-level
                      subgroups) in the workspace.
                    </CapabilityDescription>
                  </CapabilityInfo>
                  {/* A channel = root-level subgroup + a context inside it.
                      Creating a subgroup requires CAN_CREATE_SUBGROUP;
                      registering the context requires CAN_CREATE_CONTEXT
                      (the creator becomes the subgroup's admin, but
                      flipping both keeps the cap mask coherent if the
                      member ever has to create a context they don't own).
                      We toggle both together so the label matches reality. */}
                  <CapabilityToggle
                    type="checkbox"
                    checked={capToggles.canCreateSubgroup}
                    onChange={(e) =>
                      setCapToggles((current) => ({
                        ...current,
                        canCreateSubgroup: e.target.checked,
                        canCreateContext: e.target.checked,
                      }))
                    }
                  />
                </CapabilityRow>
              </CapabilitiesList>
              <CapActions>
                <SmallButton onClick={() => setCapEditIdentity(null)}>
                  Cancel
                </SmallButton>
                <SmallButton
                  onClick={saveCapabilities}
                  disabled={actionLoading}
                  style={{ color: "var(--glass-accent)", borderColor: "color-mix(in srgb, var(--glass-accent) 30%, transparent)" }}
                >
                  Save
                </SmallButton>
              </CapActions>
            </CapabilitiesOverlay>
          )}
        </React.Fragment>
        );
      })}
    </List>
  );
}
