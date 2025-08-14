import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import type { ChannelInfo, UserId } from "../../api/clientApi";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import { defaultActiveChat } from "../../mock/mock";

interface ChannelDetailsPopupProps {
  toggle: React.ReactNode;
  chat: ActiveChat;
  channelUserList?: Map<string, string>;
  nonInvitedUserList: UserId[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  selectedTabIndex: number;
  reFetchChannelMembers: () => void;
  setActiveChat: (chat: ActiveChat) => void;
  fetchChannels: () => void;
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
  fetchChannels
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

  const channelName = chat.type === "channel" ? chat.name : chat.id;

  const getChannelMetadata = async (channelName: string) => {
    const channelInfo: ResponseData<ChannelInfo> = await new ClientApiDataSource().getChannelInfo({
      channel: { name: channelName },
    });
    if (channelInfo.data) {
      setChannelMeta(prevMeta => ({
        ...prevMeta,
        createdAt: new Date(channelInfo.data.created_at * 1000).toISOString(),
        createdBy: channelInfo.data.created_by,
        createdByUsername: channelInfo.data.created_by_username,
      }));
    }
    
  };

  const handleLeaveChannel = async () => {
    await new ClientApiDataSource().leaveChannel({
      channel: { name: channelName },
    });
    setActiveChat(defaultActiveChat);
    fetchChannels();
    setIsOpen(false);
  };

  useEffect(() => {
    const fetchMetadata = async () => {
      if (chat.name) {
        await getChannelMetadata(chat.name);
      }
    }
    fetchMetadata();
  }, [chat]);

  const popupContent = (
    <DetailsContainer
      channelName={channelName}
      selectedTabIndex={selectedTabIndex}
      userList={channelUserList ?? new Map()}
      nonInvitedUserList={nonInvitedUserList}
      channelMeta={channelMeta}
      handleLeaveChannel={handleLeaveChannel}
      addMember={() => {}}
      promoteModerator={() => {}}
      removeUserFromChannel={() => {}}
      reFetchChannelMembers={reFetchChannelMembers}
    />
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
