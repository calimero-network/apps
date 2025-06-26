import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";
import { defaultActiveChat, mockChannels, mockChannelUsers } from "../../mock/mock";

interface ChannelsContainerProps {
  onChatSelected: (chat: ChannelMeta) => void;
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  setIsOpenSearchChannel: (open: boolean) => void;
  isOpenSearchChannel: boolean;
  onDMSelected: (dm: User) => void;
}

const ChannelsContainer: React.FC<ChannelsContainerProps> = (props) => {
  const {
    onChatSelected,
    activeChat,
    isSidebarOpen,
    setIsSidebarOpen,
    setIsOpenSearchChannel,
    isOpenSearchChannel,
    onDMSelected
  } = props;
  const [channels, setChannels] = useState<ChannelMeta[]>();
  const [users, setUsers] = useState<User[]>();

  useEffect(() => {
    const fetchChannels = async () => {
      // TODO: fetch channels from API
      //const channels = await getChannels();
      setChannels(mockChannels);
    }
    const fetchUsers = async () => {
      // TODO: fetch users from API
      //const users = await getUsers();
      setUsers(mockChannelUsers);
    }
    fetchChannels();
    fetchUsers();
  },[]);


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
