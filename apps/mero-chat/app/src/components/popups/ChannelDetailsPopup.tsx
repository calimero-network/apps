import React, { useEffect, useMemo, useState } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import type { ChannelInfo, UserId } from "../../api/clientApi";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { ResponseData } from "../../api/types";
import { getContextIdentity } from "../../calimero/context";
import { useWorkspace } from "../../calimero/WorkspaceProvider";
import { conversationOf } from "../../calimero/registry";
import { getGroupId } from "../../constants/config";
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
    owner: "",
    inviteOnly: false,
    type: "channel",
    channelType: "channel",
    unreadMessages: { count: 0, mentions: 0 },
    isMember: false,
    readOnly: false,
  });

  const groupId = getGroupId();
  const ws = useWorkspace();
  // A private channel's members are managed by its creator or an org admin.
  const contextSubgroupId = getSubgroupForContext && chat.contextId ? getSubgroupForContext(chat.contextId) : undefined;
  const conversation = chat.contextId ? conversationOf(chat.contextId) : undefined;
  const isPrivate = conversation?.kind === "private";
  const canAdminChannelGroup =
    isPrivate && (ws.role === "owner" || ws.role === "admin" || conversation?.owner === getContextIdentity());
  const { addToast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const isBusy = isDeleting;

  const channelName = chat.type === "channel" ? chat.name : chat.id;

  const nonChannelMembers = useMemo(() => {
    const map = new Map<string, string>();
    ws.members.forEach((m) => {
      if (!channelUserList?.has(m.account)) {
        map.set(m.account, m.name || m.account.substring(0, 12) + "...");
      }
    });
    return map;
  }, [ws.members, channelUserList]);

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
        channelType: chat.channelType || "",
      }));
    }
  };

  const currentIdentity = getContextIdentity() as string;
  const isOwner = !!channelMeta.createdBy && channelMeta.createdBy === currentIdentity;

  const handleDeleteChannel = async () => {
    if (!chat.contextId || isBusy) return;
    setIsDeleting(true);
    try {
      try {
        await ws.deleteConversation(chat.contextId);
      } catch (e) {
        addToast({
          title: "Delete channel",
          message: e instanceof Error ? e.message : "Failed to delete channel",
          type: "channel",
          duration: 4000,
        });
        return;
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
    reFetchChannelMembers();
  }, [isOpen, chat.contextId, reFetchChannelMembers]);

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
      canManageMembers={canAdminChannelGroup}
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
