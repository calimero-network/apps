import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import type { ChannelInfo, UserId } from "../../api/clientApi";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";

interface ChannelDetailsPopupProps {
  toggle: React.ReactNode;
  chat: ActiveChat;
  channelUserList?: UserId[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function ChannelDetailsPopup({
  chat,
  toggle,
  channelUserList,
  isOpen,
  setIsOpen,
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

  const channelName = chat.type === "channel" ? chat.name : chat.id;

  const getChannelMetadata = async (_channelName: string) => {
    const channelInfo: ResponseData<ChannelInfo> = await new ClientApiDataSource().getChannelInfo({
      channel: { name: _channelName },
    });
    console.log(channelInfo);
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
      selectedTabIndex={0}
      userList={channelUserList ?? []}
      channelMeta={channelMeta}
      handleLeaveChannel={() => {}}
      addMember={() => {}}
      promoteModerator={() => {}}
      removeUserFromChannel={() => {}}
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
