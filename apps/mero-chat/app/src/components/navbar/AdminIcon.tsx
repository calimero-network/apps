import { useState } from "react";
import styled from "styled-components";
import AdminPanel from "../admin/AdminPanel";
import { getGroupId } from "../../constants/config";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";

const AdminIconWrapper = styled.div`
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 999px;
  padding: 0.375rem;
  width: 36px;
  height: 36px;
  justify-content: center;
  transition: all 0.15s ease;
  &:hover {
    background-color: var(--chat-violet-soft);
    svg {
      fill: var(--chat-violet);
    }
  }
`;

// The role read failed: a small mark on the icon, so the entry is still there
// and says something is wrong rather than vanishing.
const ErrorDot = styled.span`
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--glass-bad-ink);
`;

/**
 * The workspace panel's entry, for EVERY member.
 *
 * It used to render only for admins, and `isAdmin` is false both for a member
 * and for an admin whose role lookup failed, so an admin on a flaky read lost
 * the entry with no word of why. Now members get the read-only member list
 * through it, admins get the admin controls, and a failed lookup shows the
 * entry with an error mark; the panel says what failed and offers a retry.
 */
export default function AdminIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const groupId = getGroupId();
  const permissions = useCurrentGroupPermissions(groupId);

  if (!groupId) {
    return null;
  }

  const label = permissions.error
    ? "Couldn't check your workspace role. Open to retry."
    : permissions.isAdmin
      ? "Workspace Admin"
      : "Workspace members";

  const icon = (
    <AdminIconWrapper
      title={label}
      aria-label={label}
      role="button"
      aria-busy={permissions.loading || undefined}
      data-testid="workspace-admin-icon"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="var(--glass-muted)"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      {permissions.error && <ErrorDot data-testid="workspace-admin-error" />}
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
