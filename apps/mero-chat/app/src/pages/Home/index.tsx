import { useState } from "react";
import AppContainer from "../../components/common/AppContainer";
import type { ActiveChat } from "../../types/Common";
import { mockDMActiveChat } from "../../mock/mock";

export default function Home() {
    const [activeChat, setActiveChat] = useState<ActiveChat | null>(mockDMActiveChat);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [appEndpoint, setAppEndpoint] = useState<string | null>(null);
    const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);

  return <AppContainer
    activeChat={activeChat}
    setActiveChat={setActiveChat}
    isSidebarOpen={isSidebarOpen}
    setIsSidebarOpen={setIsSidebarOpen}
    appEndpoint={appEndpoint}
    setAppEndpoint={setAppEndpoint}
    isOpenSearchChannel={isOpenSearchChannel}
    setIsOpenSearchChannel={setIsOpenSearchChannel}
  />
}