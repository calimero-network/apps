import React from "react";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";
import {
  defaultActiveChat,
} from "../../mock/mock";


interface ChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
  onDMSelected: (dm: User) => void;
  users: User[];
  channels: ChannelMeta[];
}

const ChannelsContainer: React.FC<ChannelsContainerProps> = (props) => {
  const {
    onChatSelected,
    activeChat,
    isSidebarOpen,
    setIsSidebarOpen,
    setIsOpenSearchChannel,
    isOpenSearchChannel,
    onDMSelected,
    users,
    channels,
  } = props;

  return (
    <SideSelector
      onChatSelected={onChatSelected}
      activeChat={activeChat || defaultActiveChat}
      isSidebarOpen={isSidebarOpen}
      onDMSelected={onDMSelected}
      setIsSidebarOpen={setIsSidebarOpen}
      setIsOpenSearchChannel={setIsOpenSearchChannel}
      isOpenSearchChannel={isOpenSearchChannel}
      users={users || []}
      channels={channels || []}
    />
  );
};

export default ChannelsContainer;
