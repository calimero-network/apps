import { styled } from "styled-components";
import { memo, useEffect, useState } from "react";
import type {
  ActiveChat,
  GroupContextChannel,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  CurbMessage,
} from "../../types/Common";
import type { SubgroupEntry } from "../../api/groupApi";
import ChannelsContainer from "./ChannelsContainer";
import CurbNavbar from "../navbar/CurbNavbar";
import SearchChannelsContainer from "../searchChannels/SearchChannelsContainer";
import ChatContainer from "../../chat/ChatContainer";
import type { UserId } from "../../api/clientApi";
import type { DMContextInfo } from "../../hooks/useDMs";
import type { CreateContextResult } from "../popups/StartDMPopup";
import type { ContextUnread } from "../../hooks/useUnreadCounts";

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
  onDMSelected: (dm: DMContextInfo) => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  channels: GroupContextChannel[];
  subgroups: SubgroupEntry[];
  channelsBySubgroup: Map<string, GroupContextChannel[]>;
  reFetchChannelMembers: () => void;
  fetchChannels: () => void;
  onChannelCreated?: () => void;
  onChannelLeft?: (contextId: string) => void;
  onChannelJoined?: (contextId: string) => void;
  getSubgroupForContext?: (contextId: string) => string | undefined;
  onJoinedChat: () => void;
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  chatMembers: Map<string, string>;
  dmMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  privateDMs: DMContextInfo[];
  onFetchDmMembers?: () => Promise<void>;
  unreadCounts?: Map<string, ContextUnread>;
  loadInitialThreadMessages: (
    parentMessageId: string,
  ) => Promise<ChatMessagesData>;
  incomingThreadMessages: CurbMessage[];
  loadPrevThreadMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  updateCurrentOpenThread: (thread: CurbMessage | undefined) => void;
  clearThreadsMessagesOnSwitch: () => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (thread: CurbMessage | undefined) => void;
  currentOpenThreadRef: React.RefObject<CurbMessage | undefined>;
  addOptimisticMessage?: (message: CurbMessage) => void;
  addOptimisticThreadMessage?: (message: CurbMessage) => void;
  wsIsSubscribed?: boolean;
  wsContextId?: string | null;
  wsSubscriptionCount?: number;
  searchResults: CurbMessage[];
  searchTotalCount: number;
  searchQuery: string;
  isSearchingMessages: boolean;
  searchHasMore: boolean;
  searchError: string | null;
  onSearchMessages: (query: string) => Promise<void>;
  onLoadMoreSearch: () => Promise<void>;
  onClearSearch: () => void;
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
  subgroups,
  channelsBySubgroup,
  reFetchChannelMembers,
  fetchChannels,
  onChannelCreated,
  onChannelLeft,
  onChannelJoined,
  getSubgroupForContext,
  onJoinedChat,
  loadPrevMessages,
  chatMembers,
  dmMembers,
  createDM,
  privateDMs,
  onFetchDmMembers,
  unreadCounts,
  loadInitialThreadMessages,
  incomingThreadMessages,
  loadPrevThreadMessages,
  clearThreadsMessagesOnSwitch,
  updateCurrentOpenThread,
  openThread,
  setOpenThread,
  currentOpenThreadRef,
  addOptimisticMessage,
  addOptimisticThreadMessage,
  wsIsSubscribed,
  wsContextId,
  wsSubscriptionCount,
  searchResults,
  searchTotalCount,
  searchQuery,
  isSearchingMessages,
  searchHasMore,
  searchError,
  onSearchMessages,
  onLoadMoreSearch,
  onClearSearch,
}: AppContainerProps) {
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);

  useEffect(() => {
    setIsSearchOverlayOpen(false);
  }, [activeChat?.id]);

  useEffect(() => {
    if (isOpenSearchChannel) {
      setIsSearchOverlayOpen(false);
    }
  }, [isOpenSearchChannel]);

  return (
    <>
      <CurbNavbar
        activeChat={activeChat}
        setActiveChat={(chat) => {
          if (chat) {
            updateSelectedActiveChat(chat);
          }
        }}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        isOpenSearchChannel={isOpenSearchChannel}
        setIsOpenSearchChannel={() => setIsOpenSearchChannel(true)}
        channelUserList={channelUsers}
        nonInvitedUserList={nonInvitedUserList}
        reFetchChannelMembers={reFetchChannelMembers}
        fetchChannels={fetchChannels}
        onChannelLeft={onChannelLeft}
        getSubgroupForContext={getSubgroupForContext}
        wsIsSubscribed={wsIsSubscribed}
        wsContextId={wsContextId}
        wsSubscriptionCount={wsSubscriptionCount}
        onToggleSearchOverlay={() =>
          setIsSearchOverlayOpen((previous) => !previous)
        }
        isSearchOverlayOpen={isSearchOverlayOpen}
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
          subgroups={subgroups}
          channelsBySubgroup={channelsBySubgroup}
          chatMembers={chatMembers}
          dmMembers={dmMembers}
          createDM={createDM}
          privateDMs={privateDMs}
          onChannelCreated={onChannelCreated}
          onChannelSelected={updateSelectedActiveChat}
          onFetchDmMembers={onFetchDmMembers}
          unreadCounts={unreadCounts}
        />
        {!isSidebarOpen && (
          <Wrapper>
            {!isOpenSearchChannel && activeChat && (
              <ChatContainer
                key={activeChat.contextId || activeChat.id}
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
                membersList={chatMembers}
                addOptimisticMessage={addOptimisticMessage}
                addOptimisticThreadMessage={addOptimisticThreadMessage}
                clearThreadsMessagesOnSwitch={clearThreadsMessagesOnSwitch}
                searchResults={searchResults}
                searchTotalCount={searchTotalCount}
                searchQuery={searchQuery}
                isSearchingMessages={isSearchingMessages}
                searchHasMore={searchHasMore}
                searchError={searchError}
                onSearchMessages={onSearchMessages}
                onLoadMoreSearch={onLoadMoreSearch}
                onClearSearch={onClearSearch}
                isSearchOverlayOpen={isSearchOverlayOpen}
                onCloseSearchOverlay={() => setIsSearchOverlayOpen(false)}
              />
            )}
            {isOpenSearchChannel && (
              <SearchChannelsContainer
                onChatSelected={updateSelectedActiveChat}
                fetchChannels={fetchChannels}
                onChannelJoined={onChannelJoined}
              />
            )}
          </Wrapper>
        )}
      </ContentDivContainer>
    </>
  );
}

export default memo(AppContainer);
