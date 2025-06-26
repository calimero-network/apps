import { useCallback } from "react";
import { styled } from "styled-components";
import type { User } from "../../types/Common";
import UserProfileIcon from "../profileIcon/UserProfileIcon";
import UnreadMessagesBadge from "./UnreadMessageBadge";

const UserListItem = styled.div<{ selected: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #777583;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
  border-radius: 0.5rem;
  :hover {
    color: #ffffff;
  }
  :hover {
    background-color: #25252a;
  }
  cursor: pointer;
  ${({ selected }) =>
    selected
      ? "color: #fff; background-color: #25252a;"
      : "color: #777583; background-color: #0E0E10;"}
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
  onDMSelected: (user: User) => void;
  selected: boolean;
  user: User;
}

export default function UserItem({
  onDMSelected,
  selected,
  user,
}: UserItemProps) {
  const handleClick = useCallback(() => {
    onDMSelected(user);
  }, [user, onDMSelected]);

  return (
    <UserListItem selected={selected} onClick={handleClick}>
      <UserInfoContainer>
        <UserProfileIcon accountId={user.id} active={user.active} />
        <NameContainer>{`${user.id}`}</NameContainer>
      </UserInfoContainer>
      {user?.unreadMessages && user.unreadMessages.count > 0 && (
        <UnreadMessagesBadge
          messageCount={user.unreadMessages.count}
          backgroundColor="#777583"
        />
      )}
    </UserListItem>
  );
}
