import { useState } from "react";
import styled from "styled-components";
import GroupInviteModal from "../popups/GroupInviteModal";
import { getGroupId } from "../../constants/config";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";

const GroupInviteIconWrapper = styled.button`
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 6px;
  padding: 0.375rem;
  width: 36px;
  height: 36px;
  justify-content: center;
  transition: all 0.15s ease;
  border: none;
  background: transparent;
  color: #777583;

  &:hover {
    background-color: rgba(124, 58, 237, 0.12);
    color: #a78bfa;
  }
`;

export default function GroupInviteIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const groupId = getGroupId();
  const permissions = useCurrentGroupPermissions(groupId);

  if (!groupId) {
    return null;
  }

  // Optimistic gate: hide only when role is definitively resolved to a
  // non-admin/non-moderator. While loading or if the role API fails (state
  // collapses back to initial), keep the button visible — the invite API
  // enforces the real check server-side.
  const resolved = !permissions.loading && permissions.memberIdentity !== "";
  if (resolved && !permissions.isAdmin && !permissions.isModerator) {
    return null;
  }

  return (
    <>
      <GroupInviteIconWrapper
        type="button"
        title="Invite members"
        aria-label="Invite members"
        onClick={() => setIsOpen(true)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </GroupInviteIconWrapper>
      <GroupInviteModal
        groupId={groupId}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
