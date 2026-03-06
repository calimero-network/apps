import { useCallback, memo, useState } from "react";
import { useEffect } from "react";
import { styled } from "styled-components";
import { Avatar } from "@calimero-network/mero-ui";
import type { DMChatInfo } from "../../api/clientApi";
import type { ActiveChat } from "../../types/Common";
import UnreadMessagesBadge from "./UnreadMessageBadge";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { useToast } from "../../contexts/ToastContext";
import ConfirmPopup from "../popups/ConfirmPopup";

const UserListItem = styled.div<{
  $selected: boolean;
  $hasNewMessages: boolean;
  $isCollapsed?: boolean;
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
    props.$selected
      ? "#fff"
      : props.$hasNewMessages
      ? "#c8c7d1"
      : "#5e5e6e"};

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

const TrashButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 80, 80, 0.1);
    color: rgba(255, 100, 100, 0.8);
  }
`;

interface UserItemProps {
  onDMSelected: (user?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  selected: boolean;
  userDM: DMChatInfo;
  isCollapsed?: boolean;
  selectChannel: (channel: ActiveChat) => void;
}

function UserItem({
  onDMSelected,
  selected,
  userDM,
  isCollapsed,
  selectChannel,
}: UserItemProps) {
  const { addToast } = useToast();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    const key = sessionStorage.getItem("dm-delete-open");
    if (key && key === userDM.other_identity_old) {
      setIsDeleteOpen(true);
    }
  }, [userDM.other_identity_old]);

  const handleClick = useCallback(() => {
    onDMSelected(userDM, undefined, true);
  }, [userDM, onDMSelected]);

  const confirmDelete = useCallback(async () => {
    try {
      const client = new ClientApiDataSource();
      const node = new ContextApiDataSource();

      const res = await client.deleteDM({ other_user: userDM.other_identity_old });
      if (res.error) {
        addToast({ title: "DM", message: res.error.message || "Failed to delete DM", type: "dm", duration: 3000 });
        return;
      }

      if (userDM.context_id) {
        const del = await node.deleteContext({ contextId: userDM.context_id });
        if (del.error) {
          addToast({ title: "DM", message: del.error.message || "Failed to delete DM context", type: "dm", duration: 3000 });
        }
      }

      addToast({ title: "DM", message: "DM deleted", type: "dm", duration: 2500 });
      selectChannel({ type: "channel", id: "general", name: "general" });
    } catch {
      addToast({ title: "DM", message: "Failed to delete DM", type: "dm", duration: 3000 });
    }
  }, [userDM, addToast, selectChannel]);

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
            <NameContainer>{userDM.other_username}</NameContainer>
          </UserInfoContainer>
          <ActionsContainer>
            {userDM.unread_messages > 0 && (
              <UnreadMessagesBadge
                messageCount={userDM.unread_messages.toString()}
                backgroundColor="rgba(165,255,17,0.2)"
                color="rgba(165,255,17,0.9)"
              />
            )}
            <ConfirmPopup
              title="Delete DM"
              message="This will delete the DM and its context for you. Are you sure?"
              confirmLabel="Delete"
              cancelLabel="Cancel"
              onConfirm={confirmDelete}
              onCancel={() => {
                sessionStorage.removeItem("dm-delete-open");
              }}
              toggle={
                <TrashButton
                  title="Delete DM"
                  aria-label="Delete DM"
                  onClick={(e) => {
                    e.stopPropagation();
                    sessionStorage.setItem("dm-delete-open", userDM.other_identity_old);
                    setIsDeleteOpen(true);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </TrashButton>
              }
              isOpen={isDeleteOpen}
              setIsOpen={(open) => {
                if (!open) sessionStorage.removeItem("dm-delete-open");
                setIsDeleteOpen(open);
              }}
              isChild
            />
          </ActionsContainer>
        </>
      )}
    </UserListItem>
  );
}

export default memo(UserItem);
