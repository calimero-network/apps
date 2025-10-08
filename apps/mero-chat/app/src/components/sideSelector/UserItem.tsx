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
}>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #777583;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: 0.5rem;
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
  column-gap: 0.5rem;
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
}

export default function UserItem({
  onDMSelected,
  selected,
  userDM,
}: UserItemProps) {
  const handleClick = useCallback(() => {
    onDMSelected(userDM, undefined, true);
  }, [userDM, onDMSelected]);

  return (
    <UserListItem
      $selected={selected}
      onClick={handleClick}
      $hasNewMessages={userDM.unread_messages > 0}
    >
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
    </UserListItem>
  );
}
