import React, { useEffect, useMemo, useState } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import type { ChannelInfo, UserId } from "../../api/clientApi";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import type { ResponseData } from "../../api/types";
import { getContextIdentity } from "@calimero-network/mero-react";
import { useGroupAdmin } from "../../hooks/useGroupAdmin";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { getGroupId } from "../../constants/config";
import type { GroupMember } from "../../api/groupApi";
import { useToast } from "../../contexts/ToastContext";

interface ChannelDetailsPopupProps {
  toggle: React.ReactNode;
  chat: ActiveChat;
  channelUserList?: Map<string, string>;
  nonInvitedUserList: UserId[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  selectedTabIndex: number;
  reFetchChannelMembers: () => void;
  setActiveChat: (chat: ActiveChat | null) => void;
  fetchChannels: () => void;
  onChannelLeft?: (contextId: string) => void;
  getSubgroupForContext?: (contextId: string) => string | undefined;
}

export default function ChannelDetailsPopup({
  chat,
  toggle,
  channelUserList,
  isOpen,
  setIsOpen,
  nonInvitedUserList,
  selectedTabIndex,
  reFetchChannelMembers,
  setActiveChat,
  fetchChannels,
  onChannelLeft,
  getSubgroupForContext,
}: ChannelDetailsPopupProps) {
  const [channelMeta, setChannelMeta] = useState<ChannelMeta>({
    name: chat.name,
    description: "",
    members: [],
    createdAt: "",
    createdBy: "",
    createdByUsername: "",
    owner: "",
    inviteOnly: false,
    type: "channel",
    channelType: "channel",
    unreadMessages: { count: 0, mentions: 0 },
    isMember: false,
    readOnly: false,
  });

  const groupId = getGroupId();
  const { members: groupMembers, fetchAll } = useGroupAdmin();
  const { isAdmin } = useCurrentGroupPermissions(groupId ?? "");
  const { addToast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const isBusy = isDeleting;

  const channelName = chat.type === "channel" ? chat.name : chat.id;

  const nonChannelMembers = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach((m: GroupMember) => {
      if (m.identity && !channelUserList?.has(m.identity)) {
        map.set(m.identity, m.alias || m.identity.substring(0, 12) + "...");
      }
    });
    return map;
  }, [groupMembers, channelUserList]);

  const getChannelMetadata = async (channelName: string) => {
    const channelInfo: ResponseData<ChannelInfo> =
      await new ClientApiDataSource().getChannelInfo({
        channel: { name: channelName },
      });
    if (channelInfo.data) {
      setChannelMeta((prevMeta) => ({
        ...prevMeta,
        createdAt: new Date(channelInfo.data.created_at * 1000).toISOString(),
        createdBy: channelInfo.data.created_by,
        createdByUsername: channelInfo.data.created_by_username,
        channelType: chat.channelType || "",
      }));
    }
  };

  const currentIdentity = getContextIdentity() as string;
  const isOwner = !!channelMeta.createdBy && channelMeta.createdBy === currentIdentity;
  const contextSubgroupId = chat.contextId ? getSubgroupForContext?.(chat.contextId) : undefined;

  const handleDeleteChannel = async () => {
    if (!chat.contextId || isBusy) return;
    setIsDeleting(true);
    try {
      // 1-group-per-context model: the channel lives inside a dedicated
      // subgroup. Use the deleteGroup cascade (auth: namespace-admin OR
      // CAN_DELETE_SUBGROUP at the namespace root OR subgroup-owner) — its
      // apply path unregisters the contained context as part of the
      // cascade. Calling deleteContext FIRST would re-check require_admin
      // *on the subgroup itself* (delete_context.rs:67), which blocks
      // namespace admins who didn't create the channel.
      //
      // Legacy fallback: if we couldn't resolve a subgroup for this
      // context (shouldn't happen with current channel creation), drop
      // back to deleteContext so older-data channels still work.
      if (contextSubgroupId) {
        const result = await new GroupApiDataSource().deleteGroup(contextSubgroupId);
        if (result.error) {
          addToast({
            title: "Delete channel",
            message: result.error.message || "Failed to delete channel",
            type: "channel",
            duration: 4000,
          });
          return;
        }
      } else {
        const result = await new ContextApiDataSource().deleteContext({ contextId: chat.contextId });
        if (result.error) {
          addToast({
            title: "Delete channel",
            message: result.error.message || "Failed to delete channel",
            type: "channel",
            duration: 4000,
          });
          return;
        }
      }
      onChannelLeft?.(chat.contextId);
      setActiveChat(null);
      fetchChannels();
      setIsOpen(false);
      addToast({
        title: "Channel",
        message: `Channel "${channelName}" deleted`,
        type: "channel",
        duration: 2500,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !chat.name) return;
    void getChannelMetadata(chat.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chat.name]);

  useEffect(() => {
    if (!isOpen) return;
    if (groupId) void fetchAll(groupId);
    reFetchChannelMembers();
  }, [isOpen, chat.contextId, groupId, fetchAll, reFetchChannelMembers]);

  const popupContent = (
    <DetailsContainer
      channelName={channelName}
      groupId={groupId ?? undefined}
      contextId={chat.contextId ?? undefined}
      contextSubgroupId={contextSubgroupId}
      selectedTabIndex={selectedTabIndex}
      userList={channelUserList ?? new Map()}
      nonInvitedUserList={nonInvitedUserList}
      nonChannelMembers={nonChannelMembers}
      channelMeta={channelMeta}
      isOwner={isOwner}
      canManageMembers={isOwner || isAdmin}
      handleDeleteChannel={handleDeleteChannel}
      isDeleting={isDeleting}
      promoteModerator={() => {}}
      reFetchChannelMembers={reFetchChannelMembers}
    />
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={(open) => {
        // While a delete/leave is in flight, swallow close requests
        // (Radix fires onOpenChange(false) on outside click, Escape, and
        // the X button — blocking here covers all three).
        if (isBusy && !open) return;
        setIsOpen(open);
      }}
    />
  );
}
