import { useCallback } from "react";
import { styled } from "styled-components";
import { Avatar } from "@calimero-network/mero-ui";
// import UnreadMessagesBadge from "./UnreadMessageBadge";
import type { DMChatInfo } from "../../api/clientApi";
import type { ActiveChat } from "../../types/Common";
import UnreadMessagesBadge from "./UnreadMessageBadge";

const UserListItem = styled.div<{
  $selected: boolean;
  $hasNewMessages: boolean;
  $isCollapsed?: boolean;
}>`
  display: flex;
  justify-content: ${props => props.$isCollapsed ? 'center' : 'space-between'};
  align-items: center;
  color: #777583;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  border-radius: 0.375rem;
  &:hover {
    color: #ffffff;
  }
  &:hover {
    background-color: #25252a;
  }
  cursor: pointer;
  ${({ $selected }) =>
    $selected
      ? "color: #fff; background-color: #25252a;"
      : "color: #777583; background-color: #0E0E10;"}
  ${({ $hasNewMessages }) => ($hasNewMessages ? "color: #fff !important;" : "")}
`;

const UserInfoContainer = styled.div`
  display: flex;
  column-gap: 0.375rem;
`;

const NameContainer = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  width: 100%;
`;

interface UserItemProps {
  onDMSelected: (user?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  selected: boolean;
  userDM: DMChatInfo;
  isCollapsed?: boolean;
}

export default function UserItem({
  onDMSelected,
  selected,
  userDM,
  isCollapsed,
}: UserItemProps) {
  const handleClick = useCallback(() => {
    onDMSelected(userDM, undefined, true);
  }, [userDM, onDMSelected]);

  return (
    <UserListItem
      $selected={selected}
      onClick={handleClick}
      $hasNewMessages={userDM.unread_messages > 0}
      $isCollapsed={isCollapsed}
    >
      {isCollapsed ? (
        <Avatar size="xs" name={userDM.other_username} />
      ) : (
        <>
          <UserInfoContainer>
            <Avatar size="xs" name={userDM.other_username} />
            <NameContainer>{`${userDM.other_username}`}</NameContainer>
          </UserInfoContainer>
          {userDM.unread_messages > 0 && (
            <UnreadMessagesBadge
              messageCount={userDM.unread_messages.toString()}
              backgroundColor="#777583"
            />
          )}
        </>
      )}
    </UserListItem>
  );
}
