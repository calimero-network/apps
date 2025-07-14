import { styled } from "styled-components";
import type { ActiveChat, ChannelMeta, ChatMessagesData, ChatMessagesDataWithOlder, CurbMessage } from "../../types/Common";
import ChannelsContainer from "./ChannelsContainer";
import CurbNavbar from "../navbar/CurbNavbar";
import SearchChannelsContainer from "../searchChannels/SearchChannelsContainer";
import ChatContainer from "../../chat/ChatContainer";
import type { DMChatInfo, UserId } from "../../api/clientApi";

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
  channelUsers: UserId[];
  nonInvitedUserList: UserId[];
  onDMSelected: (dm: DMChatInfo) => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  channels: ChannelMeta[];
  reFetchChannelMembers: () => void;
  fetchChannels: () => void;
  onJoinedChat: () => void;
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  chatMembers: UserId[];
  createDM: (value: string) => Promise<void>;
  privateDMs: DMChatInfo[];
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
  nonInvitedUserList,
  onDMSelected,
  loadInitialChatMessages,
  incomingMessages,
  channels,
  reFetchChannelMembers,
  fetchChannels,
  onJoinedChat,
  loadPrevMessages,
  chatMembers,
  createDM,
  privateDMs
}: AppContainerProps) {
  return (
    <>
      <CurbNavbar
        activeChat={activeChat}
        setActiveChat={updateSelectedActiveChat}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        isOpenSearchChannel={isOpenSearchChannel}
        setIsOpenSearchChannel={setIsOpenSearchChannel}
        channelUserList={channelUsers}
        nonInvitedUserList={nonInvitedUserList}
        reFetchChannelMembers={reFetchChannelMembers}
        fetchChannels={fetchChannels}
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
          channels={channels}
          chatMembers={chatMembers}
          createDM={createDM}
          privateDMs={privateDMs}
        />
        {!isSidebarOpen && (
          <Wrapper>
            {!isOpenSearchChannel && activeChat && (
              <ChatContainer
                activeChat={activeChat}
                setIsOpenSearchChannel={() => openSearchPage()}
                onJoinedChat={onJoinedChat}
                loadInitialChatMessages={loadInitialChatMessages}
                incomingMessages={incomingMessages}
                loadPrevMessages={loadPrevMessages}
              />
            )}
            {isOpenSearchChannel && (
              <SearchChannelsContainer
                onChatSelected={updateSelectedActiveChat}
                fetchChannels={fetchChannels}
              />
            )}
          </Wrapper>
        )}
      </ContentDivContainer>
    </>
  );
}
