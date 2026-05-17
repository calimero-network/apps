import { memo } from "react";
import type { DMContextInfo } from "../../hooks/useDMs";
import UserItem from "./UserItem";
import { styled } from "styled-components";
import type { ContextUnread } from "../../hooks/useUnreadCounts";

const ScrollableUserList = styled.div`
  max-height: 240px;
  overflow-y: auto;
  padding: 0 0.375rem;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;

  &::-webkit-scrollbar {
    width: 3px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background-color: rgba(255,255,255,0.1);
    border-radius: 2px;
  }
`;

interface UserListProps {
  selectedDM: string;
  onDMSelected: (dm: DMContextInfo) => void;
  privateDMs: DMContextInfo[];
  isCollapsed?: boolean;
  unreadCounts?: Map<string, ContextUnread>;
}

const UserList = memo(function UserList({
  selectedDM,
  onDMSelected,
  privateDMs,
  isCollapsed,
  unreadCounts,
}: UserListProps) {
  return (
    <ScrollableUserList>
      {privateDMs &&
        privateDMs.map((dm: DMContextInfo) => (
          <UserItem
            dm={dm}
            onDMSelected={onDMSelected}
            selected={selectedDM === dm.contextId}
            key={dm.contextId}
            isCollapsed={isCollapsed}
            unread={unreadCounts?.get(dm.contextId)}
          />
        ))}
    </ScrollableUserList>
  );
});

export default UserList;
