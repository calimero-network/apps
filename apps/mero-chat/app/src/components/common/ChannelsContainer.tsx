import React, { useEffect, useState } from "react";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import SideSelector from "../sideSelector/SideSelector";
import {
  defaultActiveChat,
  mockChannelUsers,
} from "../../mock/mock";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import type { Channels } from "../../api/clientApi";
import type { ResponseData } from "@calimero-network/calimero-client";

interface ChannelsContainerProps {
  onChatSelected: (chat: ActiveChat) => void;
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
    onDMSelected,
  } = props;
  const [channels, setChannels] = useState<ChannelMeta[]>();
  const [users, setUsers] = useState<User[]>();

  useEffect(() => {
    const fetchChannels = async () => {
      const channels: ResponseData<Channels> =
        await new ClientApiDataSource().getChannels();
      if (channels.data) {
        const channelsArray: ChannelMeta[] = Object.entries(channels.data).map(
          ([name, channelInfo]) => ({
            name,
            type: "channel" as const,
            channelType: channelInfo.channel_type,
            description: "",
            owner: channelInfo.created_by,
            members: [],
            createdBy: channelInfo.created_by,
            inviteOnly: false,
            unreadMessages: {
              count: 0,
              mentions: 0,
            },
            isMember: false,
            readOnly: channelInfo.read_only,
            createdAt: new Date(channelInfo.created_at * 1000).toISOString(),
          })
        );
        setChannels(channelsArray);
      }
    };
    const fetchUsers = async () => {
      // TODO: fetch users from API
      //const users = await getUsers();
      setUsers(mockChannelUsers);
    };
    fetchChannels();
    fetchUsers();
  }, []);

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
