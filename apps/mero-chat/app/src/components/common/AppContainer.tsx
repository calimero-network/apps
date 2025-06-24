import { styled } from "styled-components";
import type { ActiveChat } from "../../types/Common";
import NavbarContainer from "./NavbarContainer";
import ChannelsContainer from "./ChannelsContainer";

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
  activeChat: ActiveChat | null;
  setActiveChat: (chat: ActiveChat | null) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  appEndpoint: string | null;
  setAppEndpoint: (endpoint: string | null) => void;
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: (isOpen: boolean) => void;
}
export default function AppContainer({
  activeChat,
  setActiveChat,
  isSidebarOpen,
  setIsSidebarOpen,
  appEndpoint,
  setAppEndpoint,
  isOpenSearchChannel,
  setIsOpenSearchChannel,
}: AppContainerProps) {
  return (
    <>
      <NavbarContainer
        activeChat={activeChat}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        isOpenSearchChannel={isOpenSearchChannel}
        setIsOpenSearchChannel={setIsOpenSearchChannel}
        channelUserList={[
          {
            id: "1",
            name: "User 1",
            moderator: false,
            active: true,
          },
          {
            id: "2",
            name: "User 2",
            moderator: false,
            active: true,
          },
          {
            id: "3",
            name: "User 3",
            moderator: false,
            active: true,
          },
        ]}
      />
      <ContentDivContainer>
      <ChannelsContainer
        onChatSelected={() => {}}
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
