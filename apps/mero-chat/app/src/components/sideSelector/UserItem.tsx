import { useCallback, memo, useState } from "react";
import { styled } from "styled-components";
import type { DMContextInfo } from "../../hooks/useDMs";
import { IdentityAvatar } from "../IdentityAvatar";
import ConfirmPopup from "../popups/ConfirmPopup";
import { getDmDisplayName } from "../../utils/dmContext";
import { useResolvedName } from "../../repositories/names/useNames";
import type { ContextUnread } from "../../hooks/useUnreadCounts";
import { usePresence } from "../../hooks/usePresence";

const UserListItem = styled.div<{
  $selected: boolean;
  $isCollapsed?: boolean;
  $hasUnread?: boolean;
}>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.4rem ${(props) => (props.$isCollapsed ? "0" : "0.625rem")};
  border-radius: 11px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: all 0.12s ease;
  position: relative;

  background: ${(props) => (props.$selected ? "var(--chat-card)" : "transparent")};
  box-shadow: ${(props) => (props.$selected ? "var(--chat-card-shadow)" : "none")};
  color: ${(props) =>
    props.$selected ? "var(--glass-ink)" : props.$hasUnread ? "var(--glass-ink)" : "var(--glass-ink-2)"};
  font-weight: ${(props) => (props.$selected || props.$hasUnread ? "700" : "400")};

  &:hover {
    background: ${(props) =>
      props.$selected ? "var(--chat-card)" : "color-mix(in srgb, var(--glass-ink) 5%, transparent)"} !important;
    color: var(--glass-ink) !important;
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
  font-size: 14px;
  font-weight: inherit;
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

const AvatarWrapper = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const OnlineDot = styled.span<{ $online: boolean }>`
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $online }) => ($online ? "#22c55e" : "color-mix(in srgb, var(--glass-ink) 22%, transparent)")};
  border: 1.5px solid var(--glass-surface-solid);
  pointer-events: none;
`;

const UnreadBadge = styled.span<{ $isMention?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  background: ${({ $isMention }) => ($isMention ? "var(--glass-ink)" : "color-mix(in srgb, var(--glass-ink) 18%, transparent)")};
  color: ${({ $isMention }) => ($isMention ? "var(--glass-on-ink)" : "var(--glass-ink)")};
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
  const myContextKey = dm.isJoined ? (dm.contextIdentity ?? "") : "";
  const { isOnline, hasOtherOnline } = usePresence(
    dm.isJoined ? dm.contextId : undefined,
    dm.isJoined ? dm.contextIdentity : undefined,
  );
  // isOnline(dm.otherIdentity) works once getProfiles resolves the context executor key.
  // hasOtherOnline fallback handles the case where dm.otherIdentity is still a
  // namespace key (getProfiles not yet resolved / cross-node delay).
  const otherIsOnline =
    isOnline(dm.otherIdentity) || (myContextKey ? hasOtherOnline(myContextKey) : false);

  // Resolve from the account. `getDmDisplayName` is only consulted while the
  // repository has nothing yet — a DM opened before governance sync has
  // delivered the member list still has the names captured at creation, and
  // showing those beats showing a truncated account for a second.
  const resolvedName = useResolvedName(
    dm.otherIdentity || dm.namespaceMemberIdentity,
  );
  const displayName =
    resolvedName ||
    getDmDisplayName({
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
        <AvatarWrapper>
          <IdentityAvatar size="xs" identity={dm.otherIdentity} contextId={dm.contextId} name={displayName} />
          <OnlineDot $online={otherIsOnline} />
        </AvatarWrapper>
      ) : (
        <>
          <UserInfoContainer>
            <AvatarWrapper>
              <IdentityAvatar size="xs" identity={dm.otherIdentity} contextId={dm.contextId} name={displayName} />
              <OnlineDot $online={otherIsOnline} />
            </AvatarWrapper>
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
              message={`Join the direct message with ${displayName}?`}
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
