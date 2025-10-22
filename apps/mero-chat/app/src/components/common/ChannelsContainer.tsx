import React, { memo } from "react";
import type { ActiveChat, ChannelMeta } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";
import { defaultActiveChat } from "../../mock/mock";
import type { DMChatInfo } from "../../api/clientApi";
import type { CreateContextResult } from "../popups/StartDMPopup";

interface ChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  channels: ChannelMeta[];
  chatMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  privateDMs: DMChatInfo[];
}

function ChannelsContainer(props: ChannelsContainerProps) {
  const {
    onChatSelected,
    activeChat,
    isSidebarOpen,
    setIsSidebarOpen,
    setIsOpenSearchChannel,
    isOpenSearchChannel,
    onDMSelected,
    channels,
    chatMembers,
    createDM,
    privateDMs
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
      channels={channels || []}
      chatMembers={chatMembers}
      createDM={createDM}
      privateDMs={privateDMs}
    />
  );
}

export default memo(ChannelsContainer);
