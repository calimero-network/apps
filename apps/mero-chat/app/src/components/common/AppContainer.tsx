import { styled } from "styled-components";
import { memo } from "react";
import type {
  ActiveChat,
  ChannelMeta,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  CurbMessage,
} from "../../types/Common";
import ChannelsContainer from "./ChannelsContainer";
import CurbNavbar from "../navbar/CurbNavbar";
import SearchChannelsContainer from "../searchChannels/SearchChannelsContainer";
import ChatContainer from "../../chat/ChatContainer";
import type { DMChatInfo, UserId } from "../../api/clientApi";
import type { CreateContextResult } from "../popups/StartDMPopup";

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
  channelUsers: Map<string, string>;
  nonInvitedUserList: UserId[];
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  channels: ChannelMeta[];
  reFetchChannelMembers: () => void;
  fetchChannels: () => void;
  onJoinedChat: () => void;
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  chatMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  privateDMs: DMChatInfo[];
  loadInitialThreadMessages: (
    parentMessageId: string,
  ) => Promise<ChatMessagesData>;
  incomingThreadMessages: CurbMessage[];
  loadPrevThreadMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  updateCurrentOpenThread: (thread: CurbMessage | undefined) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (thread: CurbMessage | undefined) => void;
  currentOpenThreadRef: React.RefObject<CurbMessage | undefined>;
  addOptimisticMessage?: (message: CurbMessage) => void;
  addOptimisticThreadMessage?: (message: CurbMessage) => void;
  wsIsSubscribed?: boolean;
  wsContextId?: string | null;
  wsSubscriptionCount?: number;
}
function AppContainer({
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
  privateDMs,
  loadInitialThreadMessages,
  incomingThreadMessages,
  loadPrevThreadMessages,
  updateCurrentOpenThread,
  openThread,
  setOpenThread,
  currentOpenThreadRef,
  addOptimisticMessage,
  addOptimisticThreadMessage,
  wsIsSubscribed,
  wsContextId,
  wsSubscriptionCount,
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
        wsIsSubscribed={wsIsSubscribed}
        wsContextId={wsContextId}
        wsSubscriptionCount={wsSubscriptionCount}
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
                loadInitialThreadMessages={loadInitialThreadMessages}
                incomingThreadMessages={incomingThreadMessages}
                loadPrevThreadMessages={loadPrevThreadMessages}
                updateCurrentOpenThread={updateCurrentOpenThread}
                openThread={openThread}
                setOpenThread={setOpenThread}
                currentOpenThreadRef={currentOpenThreadRef}
                onDMSelected={onDMSelected}
                membersList={chatMembers}
                addOptimisticMessage={addOptimisticMessage}
                addOptimisticThreadMessage={addOptimisticThreadMessage}
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

export default memo(AppContainer);
