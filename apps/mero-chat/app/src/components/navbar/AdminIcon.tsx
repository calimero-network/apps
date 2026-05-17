import { useState } from "react";
import styled from "styled-components";
import AdminPanel from "../admin/AdminPanel";
import { getGroupId } from "../../constants/config";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";

const AdminIconWrapper = styled.div`
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
  &:hover {
    background-color: rgba(124, 58, 237, 0.12);
    svg {
      fill: #a78bfa;
    }
  }
`;

export default function AdminIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const groupId = getGroupId();
  const permissions = useCurrentGroupPermissions(groupId);

  if (!groupId || permissions.loading || !permissions.isAdmin) {
    return null;
  }

  const icon = (
    <AdminIconWrapper title="Workspace Admin">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="#777583"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    </AdminIconWrapper>
  );

  return (
    <AdminPanel
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      toggle={icon}
    />
  );
}
