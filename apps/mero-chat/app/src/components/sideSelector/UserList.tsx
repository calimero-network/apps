import { memo } from "react";
import type { DMChatInfo } from "../../api/clientApi";
import type { ActiveChat } from "../../types/Common";
import UserItem from "./UserItem";
import { styled } from "styled-components";

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
