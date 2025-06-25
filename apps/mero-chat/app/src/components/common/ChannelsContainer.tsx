import React from "react";
import type { ActiveChat } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";

interface ChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
}

const ChannelsContainer: React.FC<ChannelsContainerProps> = (props) => {
  const {
    onChatSelected,
    activeChat,
    isSidebarOpen,
    setIsSidebarOpen,
    setIsOpenSearchChannel,
    isOpenSearchChannel,
  } = props;

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
