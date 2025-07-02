import { styled } from "styled-components";
import type { ActiveChat, User } from "../../types/Common";
import ChannelsContainer from "./ChannelsContainer";
import CurbNavbar from "../navbar/CurbNavbar";
import SearchChannelsContainer from "../searchChannels/SearchChannelsContainer";
import ChatContainer from "../../chat/ChatContainer";

const ContentDivContainer = styled.div`
  width: 100%;
  @media (min-width: 1025px) {
    height: calc(100vh - 169px);
    display: flex;
  }
`;

const Wrapper = styled.div`
  @media (min-width: 1025px) {
    flex: 1;
  }
`;

interface AppContainerProps {
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: (isOpen: boolean) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  activeChat: ActiveChat | null;
  updateSelectedActiveChat: (chat: ActiveChat) => void;
  openSearchPage: () => void;
  channelUsers: User[];
  onDMSelected: (dm: User) => void;
}
export default function AppContainer({
  activeChat,
  isSidebarOpen,
  setIsSidebarOpen,
  isOpenSearchChannel,
  setIsOpenSearchChannel,
  updateSelectedActiveChat,
  openSearchPage,
  channelUsers,
  onDMSelected,
}: AppContainerProps) {
  console.log("activeChat", activeChat);
  return (
    <>
      <CurbNavbar
        activeChat={activeChat}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        isOpenSearchChannel={isOpenSearchChannel}
        setIsOpenSearchChannel={setIsOpenSearchChannel}
        channelUserList={channelUsers}
      />
      <ContentDivContainer>
        <ChannelsContainer
          onChatSelected={updateSelectedActiveChat}
          activeChat={activeChat}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          setIsOpenSearchChannel={() => openSearchPage()}
          isOpenSearchChannel={isOpenSearchChannel}
          onDMSelected={onDMSelected}
        />
        {!isSidebarOpen && (
          <Wrapper>
            {!isOpenSearchChannel && activeChat && (
              <ChatContainer
                activeChat={activeChat}
                setIsOpenSearchChannel={() => openSearchPage()}
                onJoinedChat={() => console.log("joined chat")}
              />
            )}
            {isOpenSearchChannel && (
              <SearchChannelsContainer
                onChatSelected={updateSelectedActiveChat}
              />
            )}
          </Wrapper>
        )}
      </ContentDivContainer>
    </>
  );
}
