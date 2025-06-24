import React, { useState } from "react";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import DetailsContainer from "../settings/DetailsContainer";
import BaseModal from "../common/popups/BaseModal";

interface ChannelDetailsPopupProps {
  toggle: React.ReactNode;
  chat: ActiveChat;
  channelUserList?: User[];
}

export default function ChannelDetailsPopup(props: ChannelDetailsPopupProps) {
  const { chat, toggle, channelUserList } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [channelMeta] = useState<ChannelMeta>({
    name: chat.name,
    description: "",
    members: [],
    createdAt: "",
    createdBy: "",
    owner: "",
    inviteOnly: false,
  });

  const channelName = chat.type === "channel" ? chat.name : chat.id;

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
