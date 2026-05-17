import { useCallback, memo, useState } from "react";
import { styled } from "styled-components";
import { Avatar } from "@calimero-network/mero-ui";
import type { DMContextInfo } from "../../hooks/useDMs";
import ConfirmPopup from "../popups/ConfirmPopup";
import { getDmDisplayName } from "../../utils/dmContext";
import type { ContextUnread } from "../../hooks/useUnreadCounts";

const UserListItem = styled.div<{
  $selected: boolean;
  $isCollapsed?: boolean;
  $hasUnread?: boolean;
}>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.35rem ${(props) => (props.$isCollapsed ? "0" : "0.625rem")};
  border-radius: 7px;
  cursor: pointer;
  margin-bottom: 1px;
  transition: all 0.12s ease;
  position: relative;
  border-left: 2px solid ${(props) => (props.$selected ? "#a5ff11" : "transparent")};

  background: ${(props) => (props.$selected ? "rgba(165,255,17,0.07)" : "transparent")};
  color: ${(props) =>
    props.$selected ? "#fff" : props.$hasUnread ? "#d8d8e0" : "#5e5e6e"};
  font-weight: ${(props) => (props.$hasUnread && !props.$selected ? "600" : "400")};

  &:hover {
    background: rgba(255, 255, 255, 0.05) !important;
    color: #d0d0d8 !important;
    border-left-color: ${(props) => (props.$selected ? "#a5ff11" : "rgba(165,255,17,0.3)")} !important;
  }
`;

const UserInfoContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
`;

const NameContainer = styled.div`
  font-size: 13.5px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ActionsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

const UnreadBadge = styled.span<{ $isMention?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  background: ${({ $isMention }) => ($isMention ? "#a5ff11" : "rgba(255,255,255,0.18)")};
  color: ${({ $isMention }) => ($isMention ? "#0e0e10" : "#fff")};
`;

interface UserItemProps {
  onDMSelected: (dm: DMContextInfo) => void;
  selected: boolean;
  dm: DMContextInfo;
  isCollapsed?: boolean;
  unread?: ContextUnread;
}

function UserItem({
  onDMSelected,
  selected,
  dm,
  isCollapsed,
  unread,
}: UserItemProps) {
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  const displayName = getDmDisplayName({
    otherUsername: dm.otherUsername,
    otherAlias: dm.otherAlias,
    otherIdentity: dm.otherIdentity,
    contextId: dm.contextId,
  });

  const handleClick = useCallback(() => {
    if (!dm.isJoined) {
      setIsJoinOpen(true);
      return;
    }

    onDMSelected(dm);
  }, [dm, onDMSelected]);

  const confirmJoin = useCallback(async () => {
    await onDMSelected(dm);
  }, [dm, onDMSelected]);

  const unreadMessages = unread?.messages ?? 0;
  const unreadMentions = unread?.mentions ?? 0;
  const showBadge = !selected && (unreadMessages > 0 || unreadMentions > 0);

  return (
    <UserListItem
      $selected={selected}
      onClick={handleClick}
      $isCollapsed={isCollapsed}
      $hasUnread={showBadge}
    >
      {isCollapsed ? (
        <Avatar size="xs" name={displayName} />
      ) : (
        <>
          <UserInfoContainer>
            <Avatar size="xs" name={displayName} />
            <NameContainer>{displayName}</NameContainer>
          </UserInfoContainer>
          <ActionsContainer>
            {showBadge && (
              <UnreadBadge $isMention={unreadMentions > 0}>
                {unreadMentions > 0 ? unreadMentions : unreadMessages}
              </UnreadBadge>
            )}
            <ConfirmPopup
              title="Join DM"
              message={`Join the private DM context with ${displayName}?`}
              confirmLabel="Join DM"
              cancelLabel="Cancel"
              onConfirm={confirmJoin}
              onCancel={() => {}}
              toggle={<span />}
              isOpen={isJoinOpen}
              setIsOpen={setIsJoinOpen}
              isChild
            />
          </ActionsContainer>
        </>
      )}
    </UserListItem>
  );
}

export default memo(UserItem);
