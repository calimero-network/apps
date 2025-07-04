import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import type { UserId } from "../../api/clientApi";

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
    // TODO: API
    //const channelMetadata = await getChannelMetadata(chat.id);
    // setChannelMeta({
    //   name: chat.name,
    //   description: "General channel",
    //   members: mockChannelUsers,
    //   createdAt: "2025-01-01",
    //   createdBy: "Fran",
    //   owner: "Fran",
    //   inviteOnly: false,
    //   channelType: "channel",
    //   unreadMessages: { count: 0, mentions: 0 },
    //   isMember: false,
    //   readOnly: false,
    // });
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
