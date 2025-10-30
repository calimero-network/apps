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
  justify-content: ${(props) =>
    props.$isCollapsed ? "center" : "space-between"};
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
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
`;

const TrashButton = styled.button`
  background: transparent;
  border: none;
  color: #777583;
  cursor: pointer;
  padding: 4px;
  margin-left: 8px;
  border-radius: 4px;
  &:hover {
    background-color: #2a2a2e;
    color: #fff;
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

  // Persist delete modal openness across list refetch/re-render
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

      // Switch to a channel via provided selector (default to general)
      selectChannel({ type: "channel", id: "general", name: "general" });
    } catch (_err) {
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
            <NameContainer>{`${userDM.other_username}`}</NameContainer>
          </UserInfoContainer>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {userDM.unread_messages > 0 && (
            <UnreadMessagesBadge
              messageCount={userDM.unread_messages.toString()}
              backgroundColor="#777583"
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
                  sessionStorage.setItem(
                    "dm-delete-open",
                    userDM.other_identity_old
                  );
                  setIsDeleteOpen(true);
                }}
              >
                🗑
              </TrashButton>
            }
            isOpen={isDeleteOpen}
            setIsOpen={(open) => {
              if (!open) {
                sessionStorage.removeItem("dm-delete-open");
              }
              setIsDeleteOpen(open);
            }}
            isChild
          />
          </div>
        </>
      )}
    </UserListItem>
  );
}

export default memo(UserItem);
