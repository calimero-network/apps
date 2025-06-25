import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";
import { mockChannelUsers } from "../../mock/mock";

interface ChannelDetailsPopupProps {
  toggle: React.ReactNode;
  chat: ActiveChat;
  channelUserList?: User[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function ChannelDetailsPopup(props: ChannelDetailsPopupProps) {
  const { chat, toggle, channelUserList, isOpen, setIsOpen } = props;
  const [channelMeta, setChannelMeta] = useState<ChannelMeta>({
    name: chat.name,
    description: "",
    members: [],
    createdAt: "",
    createdBy: "",
    owner: "",
    inviteOnly: false,
  });

  const channelName = chat.type === "channel" ? chat.name : chat.id;

  const getChannelMetadata = async () => {
    // TODO: API
    //const channelMetadata = await getChannelMetadata(chat.id);
    setChannelMeta({
      name: chat.name,
      description: "General channel",
      members: mockChannelUsers,
      createdAt: "2025-01-01",
      createdBy: "Fran",
      owner: "Fran",
      inviteOnly: false,
    });
  };

  useEffect(() => {
    const fetchMetadata = async () => {
      if (chat.id) {
        await getChannelMetadata();
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
