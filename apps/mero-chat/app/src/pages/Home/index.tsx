import { useCallback, useEffect, useState } from "react";
import AppContainer from "../../components/common/AppContainer";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import { getStoredSession } from "../../utils/session";
import { mockChannelUsers } from "../../mock/mock";

export default function Home() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>({
    type: "channel",
    id: "1",
    name: "general",
    readOnly: false,
  });

  const [channelUsers, setChannelUsers] = useState<User[]>([]);

  const getChannelUsers = useCallback((channelId: string) => {
    // API call to get channel users
    console.log("getChannelUsers", channelId);
    const channelUsers = mockChannelUsers;
    setChannelUsers(channelUsers);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateSelectedActiveChat = useCallback((selectedChat: ChannelMeta) => {
    setIsOpenSearchChannel(false);
    //setActiveChat(selectedChat);
    //getChannelUsers(selectedChat.id);
    setIsSidebarOpen(false);
    //updateSessionChat(selectedChat);
  }, []);

  const openSearchPage = useCallback(() => {
    setIsOpenSearchChannel(true);
    setIsSidebarOpen(false);
    setActiveChat(null);
  }, []);

  useEffect(() => {
    const storedSession: ActiveChat | null = getStoredSession();
    if (storedSession) {
      setActiveChat(storedSession);
    }
    getChannelUsers(activeChat?.id || "");
  }, []);

  const onDMSelected = useCallback((dm: User) => {
    setActiveChat({
      type: "direct_message",
      name: dm.id,
      id: dm.id,
    });
  }, []);

  return (
    <AppContainer
      isOpenSearchChannel={isOpenSearchChannel}
      setIsOpenSearchChannel={setIsOpenSearchChannel}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      activeChat={activeChat}
      setActiveChat={setActiveChat}
      updateSelectedActiveChat={updateSelectedActiveChat}
      openSearchPage={openSearchPage}
      channelUsers={channelUsers}
      onDMSelected={onDMSelected}
    />
  );
}
