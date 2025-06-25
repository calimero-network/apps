import React from "react";
import type { ActiveChat } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";

interface ChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  enableCommunities: boolean;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
}

const ChannelsContainer: React.FC<ChannelsContainerProps> = (props) => {
  const onChatSelected = props.onChatSelected;
  const activeChat = props.activeChat;
  const isSidebarOpen = props.isSidebarOpen;
  const setIsSidebarOpen = props.setIsSidebarOpen;
  const setIsOpenSearchChannel = props.setIsOpenSearchChannel;
  const isOpenSearchChannel = props.isOpenSearchChannel;

  const defaultActiveChat: ActiveChat = {
    type: "channel",
    id: "1",
    name: "general",
    readOnly: false,
  };

  return (
    <SideSelector
      onChatSelected={onChatSelected}
      activeChat={activeChat || defaultActiveChat}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      setIsOpenSearchChannel={setIsOpenSearchChannel}
      isOpenSearchChannel={isOpenSearchChannel}
      users={[]}
      channels={[]}
    />
  );
};

export default ChannelsContainer;
