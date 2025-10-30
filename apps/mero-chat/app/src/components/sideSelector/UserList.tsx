import { memo } from "react";
import type { DMChatInfo } from "../../api/clientApi";
import type { ActiveChat } from "../../types/Common";
import UserItem from "./UserItem";
import { styled } from "styled-components";

const ScrollableUserList = styled.div`
  max-height: 240px; /* Approximately 6 items * 40px height */
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #282933 transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background-color: #282933;
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background-color: #404040;
  }
`;

interface UserListProps {
  selectedDM: string;
  onDMSelected: (user?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  privateDMs: DMChatInfo[];
  isCollapsed?: boolean;
  selectChannel: (channel: ActiveChat) => void;
}

const UserList = memo(function UserList({
  selectedDM,
  onDMSelected,
  privateDMs,
  isCollapsed,
  selectChannel
}: UserListProps) {
  return (
    <ScrollableUserList>
      {privateDMs &&
        privateDMs.map((userDM: DMChatInfo) => (
          <UserItem
            userDM={userDM}
            onDMSelected={onDMSelected}
            selected={selectedDM === userDM.other_identity_old}
            key={userDM.other_identity_old}
            isCollapsed={isCollapsed}
            selectChannel={selectChannel}
          />
        ))}
    </ScrollableUserList>
  );
});

export default UserList;
