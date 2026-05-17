import React, { useState } from "react";
import styled from "styled-components";
import { Avatar } from "@calimero-network/mero-ui";
import type { GroupMember, MemberCapabilities } from "../../api/groupApi";
import ConfirmPopup from "../popups/ConfirmPopup";
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
  border-radius: 6px;
  transition: background 0.12s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.04);
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
  color: #fff;
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
  border-radius: 4px;
  background: ${({ $admin }) =>
    $admin ? "rgba(124, 58, 237, 0.15)" : "rgba(255, 255, 255, 0.06)"};
  color: ${({ $admin }) =>
    $admin ? "#a78bfa" : "rgba(255, 255, 255, 0.4)"};
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
`;

const SmallButton = styled.button`
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const RemoveButton = styled(SmallButton)`
  border-color: rgba(239, 68, 68, 0.2);
  color: rgba(239, 68, 68, 0.7);
  &:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.4);
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.82rem;
`;

const CapabilitiesOverlay = styled.div`
  background: #1a1a1e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 0.625rem;
  margin-top: 0.25rem;
  margin-bottom: 0.25rem;
`;

const CapLabel = styled.div`
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
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
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
`;

const CapabilityInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
`;

const CapabilityTitle = styled.div`
  color: #fff;
  font-size: 0.78rem;
  font-weight: 500;
`;

const CapabilityDescription = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.68rem;
  line-height: 1.4;
`;

const CapabilityToggle = styled.input`
  width: 18px;
  height: 18px;
  accent-color: #a5ff11;
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
  actionLoading: boolean;
  onRemoveMember: (groupId: string, identity: string) => Promise<boolean>;
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
  actionLoading,
  onRemoveMember,
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

  return (
    <List>
      {members.map((member) => (
        <React.Fragment key={member.identity}>
          <MemberRow>
            <MemberInfo>
              <Avatar size="xs" name={getMemberDisplayName(member)} />
              <IdentityStack>
                <Identity title={member.identity}>
                  {getMemberDisplayName(member)}
                </Identity>
              </IdentityStack>
              <RoleBadge $admin={member.role === "Admin"}>
                {member.role}
              </RoleBadge>
            </MemberInfo>
            <Actions>
              {member.role !== "Admin" && (
                <SmallButton
                  onClick={() => openCapabilities(member.identity)}
                  disabled={actionLoading}
                >
                  Capabilities
                </SmallButton>
              )}
              {member.role !== "Admin" && (
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

          {member.role !== "Admin" && capEditIdentity === member.identity && (
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
                  style={{ color: "#a5ff11", borderColor: "rgba(165,255,17,0.3)" }}
                >
                  Save
                </SmallButton>
              </CapActions>
            </CapabilitiesOverlay>
          )}
        </React.Fragment>
      ))}
    </List>
  );
}
