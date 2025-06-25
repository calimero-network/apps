import { styled } from "styled-components";
import type { ActiveChat, ChannelMeta, User } from "../../types/Common";
import ChannelsContainer from "./ChannelsContainer";
import CurbNavbar from "../navbar/CurbNavbar";

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
  setActiveChat: (chat: ActiveChat | null) => void;
  updateSelectedActiveChat: (chat: ChannelMeta) => void;
  openSearchPage: () => void;
  channelUsers: User[];
}
export default function AppContainer({
  activeChat,
  setActiveChat,
  isSidebarOpen,
  setIsSidebarOpen,
  isOpenSearchChannel,
  setIsOpenSearchChannel,
  updateSelectedActiveChat,
  openSearchPage,
  channelUsers
}: AppContainerProps) {
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
        setIsOpenSearchChannel={setIsOpenSearchChannel}
        isOpenSearchChannel={isOpenSearchChannel}
      />
      {!isSidebarOpen && (
        <Wrapper>
          {/* {!isOpenSearchChannel && (
            <Widget
              src={`${componentOwnerId}/widget/Calimero.Curb.Chat.ChatContainer`}
              props={{
                componentOwnerId,
                contract,
                curbApi,
                activeChat,
                accountId,
                wsApi,
                isWsConnectionActive,
                setIsOpenSearchChannel: () => openSearchPage(),
                onJoinedChat: updateSelectedActiveChat,
              }}
            />
          )}
          {isOpenSearchChannel && (
            <Widget
              src={`${componentOwnerId}/widget/Calimero.Curb.SearchChannels.SearchChannelsContainer`}
              props={{
                componentOwnerId,
                curbApi,
                accountId,
                onChatSelected: updateSelectedActiveChat,
              }}
            />
          )} */}
        </Wrapper>
      )}
    </ContentDivContainer>
    </>
  );
}
