import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import type { FormEvent } from "react";
import { styled } from "styled-components";
import { log } from "../utils/logger";
import type {
  ActiveChat,
  AttachmentDraft,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  CurbFile,
  CurbMessage,
  SendMessagePayload,
  UpdatedMessages,
} from "../types/Common";
import { MessageStatus } from "../types/Common";
import JoinChannel from "./JoinChannel";
import ChatDisplaySplit from "./ChatDisplaySplit";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import {
  getContextId,
  getContextIdentity as getExecutorPublicKey,
} from "@calimero-network/mero-react";
import type { ResponseData } from "../api/types";
import type { ChannelInfo, UserId } from "../api/clientApi";
import { extractAndAddMentions } from "../utils/mentions";
import ChatSearchOverlay from "./ChatSearchOverlay";
import { isSelfSender } from "../utils/selfIdentity";
import { getSelfAccountBase58 } from "../utils/accountIdentity";

interface ChatContainerProps {
  activeChat: ActiveChat;
  setIsOpenSearchChannel: () => void;
  onJoinedChat: () => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  /** Id of the message a permalink pointed at, if this view was opened by one. */
  focusMessageId?: string | null;
  /** Copy a shareable link to a message. */
  copyMessageLink?: (message: CurbMessage) => void;
  /** Leave a permalink's window and return to the newest messages. */
  onJumpToPresent?: () => void;
  /** Bump to reload the newest window without changing channel. */
  reloadKey?: number;
  incomingMessages: CurbMessage[];
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  loadInitialThreadMessages: (
    parentMessageId: string
  ) => Promise<ChatMessagesData>;
  incomingThreadMessages: CurbMessage[];
  loadPrevThreadMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  updateCurrentOpenThread: (thread: CurbMessage | undefined) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (thread: CurbMessage | undefined) => void;
  currentOpenThreadRef: React.RefObject<CurbMessage | undefined>;
  membersList: Map<string, string>;
  addOptimisticMessage?: (message: CurbMessage) => void;
  addOptimisticThreadMessage?: (message: CurbMessage) => void;
  clearThreadsMessagesOnSwitch: () => void;
  searchResults: CurbMessage[];
  searchTotalCount: number;
  searchQuery: string;
  isSearchingMessages: boolean;
  searchHasMore: boolean;
  searchError: string | null;
  onSearchMessages: (query: string) => Promise<void>;
  onLoadMoreSearch: () => Promise<void>;
  onClearSearch: () => void;
  isSearchOverlayOpen: boolean;
  onCloseSearchOverlay: () => void;
  onSearchResultClick?: (contextId: string) => void;
}

const ChatContainerWrapper = styled.div`
  position: relative;
  display: flex;
  background-color: #0e0e10;
  @media (min-width: 1025px) {
    padding-left: 4px;
    height: calc(100vh - 81px);
  }
  @media (max-width: 1024px) {
    display: flex;
    flex-direction: column;
    padding-top: 42px;
  }
`;

const ThreadWrapper = styled.div`
  height: 100%;
  flex: 1;
  border-left: 2px solid #282933;
  padding-left: 20px;
  @media (max-width: 1024px) {
    height: 100dvh;
    border-left: none;
    position: fixed;
    padding-left: 0px;
    padding-top: 0px;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 30;
    background-color: #0e0e10;
  }
`;

function ChatContainer({
  activeChat,
  setIsOpenSearchChannel,
  onJoinedChat,
  loadInitialChatMessages,
  focusMessageId,
  copyMessageLink,
  onJumpToPresent,
  reloadKey,
  incomingMessages,
  loadPrevMessages,
  loadInitialThreadMessages,
  incomingThreadMessages,
  loadPrevThreadMessages,
  updateCurrentOpenThread,
  openThread,
  setOpenThread,
  currentOpenThreadRef,
  membersList,
  addOptimisticMessage,
  addOptimisticThreadMessage,
  clearThreadsMessagesOnSwitch,
  searchResults,
  searchTotalCount,
  searchQuery,
  isSearchingMessages,
  searchHasMore,
  searchError,
  onSearchMessages,
  onLoadMoreSearch,
  onClearSearch,
  isSearchOverlayOpen,
  onCloseSearchOverlay,
  onSearchResultClick,
}: ChatContainerProps) {
  const [updatedMessages, setUpdatedMessages] = useState<UpdatedMessages[]>([]);
  const [_updatedThreadMessages, setUpdatedThreadMessages] = useState<
    UpdatedMessages[]
  >([]);
  const [isEmojiSelectorVisible, setIsEmojiSelectorVisible] = useState(false);
  const [channelMeta, setChannelMeta] = useState<ChannelInfo>(
    {} as ChannelInfo
  );
  const [openMobileReactions, setOpenMobileReactions] = useState("");
  const [messageWithEmojiSelector, setMessageWithEmojiSelector] =
    useState<CurbMessage | null>(null);
  const [searchInputValue, setSearchInputValue] = useState(searchQuery);

  // Track last fetched channel to prevent excessive API calls
  const lastFetchedChannelRef = useRef<string>("");

  useEffect(() => {
    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const fetchChannelMeta = async () => {
      // Skip for DMs - they don't have channel info
      if (activeChat.type === "direct_message") {
        setChannelMeta({} as ChannelInfo);
        return;
      }

      // Only fetch if we haven't fetched for this channel yet
      if (lastFetchedChannelRef.current === activeChat.name) {
        return;
      }

      lastFetchedChannelRef.current = activeChat.name;

      const channelMeta: ResponseData<ChannelInfo> =
        await new ClientApiDataSource().getChannelInfo({
          channel: { name: activeChat.name },
        });
      if (channelMeta.data) {
        setChannelMeta(channelMeta.data);
      }
    };
    fetchChannelMeta();
  }, [activeChat.name, activeChat.type]);

  const activeChatRef = useRef(activeChat);
  const membersListRef = useRef(membersList);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    membersListRef.current = membersList;
  }, [membersList]);

  const handleReaction = useCallback(
    async (message: CurbMessage, reaction: string, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      // "Have I already reacted" is an identity question, so ask it of the
      // ACCOUNT. This compared display names, which meant a rename made your
      // own reaction look like someone else's and two members sharing a name
      // toggled each other's.
      const accounts = message.reactions?.[reaction] ?? [];
      const alreadyReacted =
        Array.isArray(accounts) &&
        accounts.some((account) =>
          isSelfSender(
            account,
            activeChatRef.current?.contextId ?? "",
            activeChatRef.current?.contextIdentity,
          ),
        );
      const isAdding = !alreadyReacted;

      try {
        const response = await new ClientApiDataSource().updateReaction({
          messageId: message.id,
          emoji: reaction,
          add: isAdding,
          is_dm: isDM,
          dm_identity: activeChatRef.current?.contextIdentity,
        });
        if (response.data || !response.error) {
          // Use isAdding (captured at call time) so the update is idempotent
          // regardless of whether a WebSocket update arrived first.
          // Reactions are keyed by ACCOUNT — the id the contract stamps from
          // `executor_id()`, in the base58 form it emits. The name that used to
          // sit here was a leftover from when messages carried a username, and
          // it no longer exists in any scope: reacting threw before the
          // optimistic update could run.
          const selfAccount = getSelfAccountBase58();
          const updateFunction = (msg: CurbMessage) => {
            const msgAccounts = msg.reactions?.[reaction] ?? [];
            const updatedAccounts = isAdding
              ? msgAccounts.includes(selfAccount)
                ? msgAccounts
                : [...msgAccounts, selfAccount]
              : msgAccounts.filter((a: string) => a !== selfAccount);
            return { reactions: { ...msg.reactions, [reaction]: updatedAccounts } };
          };
          // Without a known account there is nothing correct to paint: adding
          // an empty id would render a phantom reactor and, worse, make the
          // "did I react" check true for everyone. The write already succeeded,
          // so the event carries the real state along shortly.
          if (!selfAccount) {
            log.warn(
              "ChatContainer",
              "No self account yet; skipping optimistic reaction update",
            );
          } else if (isThread) {
            setUpdatedThreadMessages([
              { id: message.id, descriptor: { updateFunction } },
            ]);
          } else {
            setUpdatedMessages([
              { id: message.id, descriptor: { updateFunction } },
            ]);
          }
        }
      } catch (error) {
        log.error("ChatContainer", "Error updating reaction", error);
      }
    },
    []
  );

  const getIconFromCache = useCallback(
    (_accountId: string): Promise<string | null> => {
      const fallbackImage = "https://i.imgur.com/e8buxpa.png";
      return Promise.resolve(fallbackImage);
    },
    []
  );

  const toggleEmojiSelector = useCallback(
    (message: CurbMessage) => {
      setMessageWithEmojiSelector(message);
      setIsEmojiSelectorVisible((prev) => !prev);
    },
    [setIsEmojiSelectorVisible]
  );

  const sendMessage = async (
    payload: SendMessagePayload,
    isThread: boolean,
  ) => {
    const messageText = payload.text ?? "";
    log.debug(
      "ChatContainer",
      `sendMessage called with payload:${payload}, isThread: ${isThread}`,
    );
    const isDM = activeChatRef.current?.type === "direct_message";

    const result = extractAndAddMentions(messageText, membersListRef.current);
    const mentions: UserId[] = [...result.userIdMentions];
    const usernames: string[] = [...result.usernameMentions];

    const optimisticFunction = isThread
      ? addOptimisticThreadMessage
      : addOptimisticMessage;

    const tempId = `temp-${Date.now()}`;

    const buildCurbFiles = (
      drafts: AttachmentDraft[] | undefined,
    ): CurbFile[] =>
      (drafts ?? []).map((draft) => ({
        name: draft.name,
        ipfs_cid: draft.blobId,
        mime_type: draft.mimeType,
        size: draft.size,
        uploaded_at: draft.uploadedAt ?? Date.now(),
        preview_url: draft.previewUrl,
      }));

    const optimisticFiles = buildCurbFiles(payload.files);
    const optimisticImages = buildCurbFiles(payload.images);

    if (optimisticFunction) {
      const sender = isDM
        ? activeChatRef.current?.contextIdentity || getExecutorPublicKey() || ""
        : getExecutorPublicKey() || "";

      const optimisticMessage: CurbMessage = {
        id: tempId,
        text: messageText,
        nonce: Math.random().toString(36).substring(2, 15),
        key: tempId,
        timestamp: Date.now(),
        sender,
        reactions: {},
        editedOn: undefined,
        mentions,
        files: optimisticFiles,
        images: optimisticImages,
        editMode: false,
        status: MessageStatus.sent,
        deleted: false,
      };

      try {
        optimisticFunction(optimisticMessage);
      } catch (error) {
        log.error("ChatContainer", "Error adding optimistic message", error);
      }
    }

    const parentMessageId = isThread
      ? currentOpenThreadRef.current?.key || currentOpenThreadRef.current?.id
      : undefined;

    const response = await new ClientApiDataSource().sendMessage({
      group: {
        name: (isDM ? "private_dm" : activeChatRef.current?.name) ?? "",
      },
      message: messageText,
      mentions,
      usernames,
      timestamp: Math.floor(Date.now() / 1000),
      is_dm: isDM,
      dm_identity: activeChatRef.current?.contextIdentity,
      parent_message: parentMessageId,
      files:
        payload.files && payload.files.length > 0
          ? payload.files.map((attachment) => ({
              name: attachment.name,
              blob_id_str: attachment.blobId,
              mime_type: attachment.mimeType,
              size: attachment.size,
            }))
          : undefined,
      images:
        payload.images && payload.images.length > 0
          ? payload.images.map((attachment) => ({
              name: attachment.name,
              blob_id_str: attachment.blobId,
              mime_type: attachment.mimeType,
              size: attachment.size,
            }))
          : undefined,
    });

    if (response.data?.id && optimisticFunction) {
      const realMessageId = response.data.id;
      const responseFiles = buildCurbFiles(
        response.data.files?.map((file) => ({
          blobId: file.blob_id,
          name: file.name,
          mimeType: file.mime_type,
          size: file.size,
          uploadedAt: file.uploaded_at,
        })),
      );
      const responseImages = buildCurbFiles(
        response.data.images?.map((file) => ({
          blobId: file.blob_id,
          name: file.name,
          mimeType: file.mime_type,
          size: file.size,
          uploadedAt: file.uploaded_at,
        })),
      );

      const updatedMessage: CurbMessage = {
        id: realMessageId,
        text: messageText,
        nonce: Math.random().toString(36).substring(2, 15),
        key: realMessageId,
        timestamp: Math.floor(Date.now() / 1000) * 1000,
        sender: isDM
          ? activeChatRef.current?.contextIdentity || getExecutorPublicKey() || ""
          : getExecutorPublicKey() || "",
        reactions: {},
        editedOn: undefined,
        mentions,
        files: responseFiles.length ? responseFiles : optimisticFiles,
        images: responseImages.length ? responseImages : optimisticImages,
        editMode: false,
        status: MessageStatus.sent,
        deleted: false,
      };

      const update = [
        {
          id: tempId,
          descriptor: {
            updatedFields: {
              id: realMessageId,
            },
          },
        },
      ];
      if (isThread) {
        setUpdatedThreadMessages(update);
      } else {
        setUpdatedMessages(update);
      }

      optimisticFunction(updatedMessage);
    }

    if (isThread && currentOpenThreadRef.current) {
      const newThreadCount =
        (currentOpenThreadRef.current.threadCount ?? 0) + 1;
      const newThreadLastTimestamp = Math.floor(Date.now() / 1000);
      const update = [
        {
          id: currentOpenThreadRef.current.id,
          descriptor: {
            updateFunction: () => ({
              threadCount: newThreadCount,
              threadLastTimestamp: newThreadLastTimestamp,
            }),
          },
        },
      ];
      setUpdatedMessages(update);
      currentOpenThreadRef.current = {
        ...currentOpenThreadRef.current,
        threadCount: newThreadCount,
        threadLastTimestamp: newThreadLastTimestamp,
      };
      setOpenThread(currentOpenThreadRef.current);
      updateCurrentOpenThread(currentOpenThreadRef.current);
    }
  };

  const handleDeleteMessage = useCallback(
    async (message: CurbMessage, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      
      // Get parent message ID for thread messages
      const parentMessageId = isThread
        ? currentOpenThreadRef.current?.key || currentOpenThreadRef.current?.id
        : undefined;
      
      const response = await new ClientApiDataSource().deleteMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.contextIdentity,
        parent_id: parentMessageId, // Add parent message ID for thread messages
      });
      
      if (response.data) {
        const update = [
          { id: message.id, descriptor: { updatedFields: { deleted: true } } },
        ];
        if (isThread) {
          setUpdatedThreadMessages(update);
        } else {
          setUpdatedMessages(update);
        }
      }
    },
    [currentOpenThreadRef],
  );

  const handleEditMode = useCallback(
    (message: CurbMessage, isThread: boolean) => {
      const update = [
        {
          id: message.id,
          descriptor: {
            updatedFields: { editMode: !message.editMode },
          },
        },
      ];
      if (isThread) {
        setUpdatedThreadMessages(update);
      } else {
        setUpdatedMessages(update);
      }
    },
    [] // No external dependencies needed
  );

  const handleEditedMessage = useCallback(
    async (message: CurbMessage, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const editedOn = Math.floor(Date.now() / 1000);
      
      // Get parent message ID for thread messages
      const parentMessageId = isThread
        ? currentOpenThreadRef.current?.key || currentOpenThreadRef.current?.id
        : undefined;
      
      const response = await new ClientApiDataSource().editMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        newMessage: message.text,
        timestamp: editedOn,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.contextIdentity,
        parent_id: parentMessageId, // Add parent message ID for thread messages
      });
      
      if (response.data) {
        const update = [
          {
            id: message.id,
            descriptor: {
              updatedFields: {
                text: message.text,
                editMode: false,
                editedOn: editedOn,
              },
            },
          },
        ];
        if (isThread) {
          setUpdatedThreadMessages(update);
        } else {
          setUpdatedMessages(update);
        }
      }
    },
    [currentOpenThreadRef],
  );

  const selectThread = (message: CurbMessage) => {
    clearThreadsMessagesOnSwitch();
    // Extract the real message ID from the key (before any _nonce_version suffix)
    // The key format is: originalId_nonce_version, but we need just the originalId for API calls
    const realMessageId = message.key || message.id;
    log.debug(
      "ChatContainer",
      `Opening thread for message - id: ${message.id}, key: ${message.key}, using: ${realMessageId}`
    );
    log.debug("ChatContainer", `Message details:`, {
      id: message.id,
      key: message.key,
      realMessageId,
      text: message.text,
      sender: message.sender,
      timestamp: message.timestamp,
    });
    setOpenThread(message);
    updateCurrentOpenThread(message);
    setUpdatedThreadMessages([]);
  };

  const closeThread = () => {
    log.debug("ChatContainer", "Closing thread");
    setOpenThread(undefined);
    updateCurrentOpenThread(undefined);
    setUpdatedThreadMessages([]);
  };

  // Memoize the thread loadInitialChatMessages function
  // Capture the parent message ID at the time of thread opening
  const parentMessageId = openThread?.key || openThread?.id || "";

  const threadLoadInitialChatMessages = useCallback(() => {
    log.debug(
      "ChatContainer",
      `Thread loadInitialChatMessages called with parentMessageId: ${parentMessageId}`
    );
    return loadInitialThreadMessages(parentMessageId);
  }, [parentMessageId, loadInitialThreadMessages]);

  // Debug logging for thread state
  useEffect(() => {
    if (openThread) {
      log.debug(
        "ChatContainer",
        `Thread component should be visible for message: ${openThread.id}`
      );
    }
  }, [openThread]);

  const handleSearchSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await onSearchMessages(searchInputValue);
    },
    [onSearchMessages, searchInputValue],
  );

  const handleClearSearch = useCallback(() => {
    setSearchInputValue("");
    onClearSearch();
  }, [onClearSearch]);

  useEffect(() => {
    if (!isSearchOverlayOpen) {
      handleClearSearch();
    }
  }, [isSearchOverlayOpen, handleClearSearch]);

  const handleLoadMoreSearch = useCallback(async () => {
    if (!searchQuery) return;
    await onLoadMoreSearch();
  }, [onLoadMoreSearch, searchQuery]);

  const searchContextId = useMemo(() => {
    if (activeChat.contextId && activeChat.contextId.length > 0) {
      return activeChat.contextId;
    }
    return getContextId() ?? "";
  }, [activeChat.contextId]);

  const trimmedSearchInput = searchInputValue.trim();
  const hasSearchResults = searchResults.length > 0;
  const hasSearchQuery = searchQuery.length > 0;
  const searchButtonDisabled =
    trimmedSearchInput.length === 0 || isSearchingMessages;
  const clearButtonDisabled =
    (trimmedSearchInput.length === 0 &&
      !hasSearchQuery &&
      !hasSearchResults) ||
    isSearchingMessages;

  return (
    <ChatContainerWrapper>
      {isSearchOverlayOpen && (
        <ChatSearchOverlay
          searchInputValue={searchInputValue}
          onSearchInputChange={setSearchInputValue}
          searchButtonDisabled={searchButtonDisabled}
          isSearchingMessages={isSearchingMessages}
          onSearchSubmit={handleSearchSubmit}
          onClearSearch={handleClearSearch}
          clearButtonDisabled={clearButtonDisabled}
          searchError={searchError}
          hasSearchQuery={hasSearchQuery}
          hasSearchResults={hasSearchResults}
          searchQuery={searchQuery}
          searchResults={searchResults}
          searchTotalCount={searchTotalCount}
          searchHasMore={searchHasMore}
          onLoadMoreSearch={handleLoadMoreSearch}
          onClose={() => {
            handleClearSearch();
            onCloseSearchOverlay();
          }}
          searchContextId={searchContextId}
          onResultClick={onSearchResultClick}
        />
      )}
      {activeChat.canJoin && activeChat.type === "channel" ? (
        <JoinChannel
          channelMeta={channelMeta}
          activeChat={activeChat}
          setIsOpenSearchChannel={setIsOpenSearchChannel}
          onJoinedChat={onJoinedChat}
        />
      ) : (
        <>
          <ChatDisplaySplit
            readMessage={() => {}}
            handleReaction={handleReaction}
            openThread={openThread}
            setOpenThread={selectThread}
            closeThread={closeThread}
            activeChat={activeChat}
            updatedMessages={updatedMessages}
            resetImage={() => {}}
            sendMessage={(payload) => sendMessage(payload, false)}
            getIconFromCache={getIconFromCache}
            isThread={false}
            isReadOnly={activeChat.readOnly ?? false}
            toggleEmojiSelector={toggleEmojiSelector}
            channelMeta={channelMeta}
            openMobileReactions={openMobileReactions}
            setOpenMobileReactions={setOpenMobileReactions}
            onMessageDeletion={handleDeleteMessage}
            onEditModeRequested={handleEditMode}
            onEditModeCancelled={handleEditMode}
            onMessageUpdated={handleEditedMessage}
            loadInitialChatMessages={loadInitialChatMessages}
            incomingMessages={incomingMessages}
            loadPrevMessages={loadPrevMessages}
            currentOpenThreadRef={currentOpenThreadRef}
            isEmojiSelectorVisible={isEmojiSelectorVisible}
            setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
            messageWithEmojiSelector={messageWithEmojiSelector}
            focusMessageId={focusMessageId}
            copyMessageLink={copyMessageLink}
            onJumpToPresent={onJumpToPresent}
            reloadKey={reloadKey}
          />
          {openThread && (
            <ThreadWrapper>
              <ChatDisplaySplit
                readMessage={() => {}}
                handleReaction={handleReaction}
                openThread={openThread}
                setOpenThread={selectThread}
                closeThread={closeThread}
                activeChat={activeChat}
                updatedMessages={_updatedThreadMessages}
                resetImage={() => {}}
                sendMessage={(payload) => sendMessage(payload, true)}
                getIconFromCache={getIconFromCache}
                isThread={true}
                isReadOnly={activeChat.readOnly ?? false}
                toggleEmojiSelector={toggleEmojiSelector}
                channelMeta={channelMeta}
                openMobileReactions={openMobileReactions}
                setOpenMobileReactions={setOpenMobileReactions}
                onMessageDeletion={handleDeleteMessage}
                onEditModeRequested={handleEditMode}
                onEditModeCancelled={handleEditMode}
                onMessageUpdated={handleEditedMessage}
                loadInitialChatMessages={threadLoadInitialChatMessages}
                incomingMessages={incomingThreadMessages}
                loadPrevMessages={(id: string) =>
                  loadPrevThreadMessages(id)
                }
                currentOpenThreadRef={currentOpenThreadRef}
                isEmojiSelectorVisible={isEmojiSelectorVisible}
                setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
                messageWithEmojiSelector={messageWithEmojiSelector}
              />
            </ThreadWrapper>
          )}
        </>
      )}
    </ChatContainerWrapper>
  );
}

// Custom comparison to prevent re-renders when only function references change
export default memo(ChatContainer, (prevProps, nextProps) => {
  // Re-render only if these key values actually change.
  //
  // NOTE: this list is hand-maintained, so a prop added to `ChatContainerProps`
  // and NOT added here is silently ignored forever — the component keeps
  // rendering with the old value and nothing reports it. That is exactly what
  // happened to the permalink props: `focusMessageId` changed, this comparator
  // said "equal", and the linked message was never marked.
  return (
    prevProps.activeChat.id === nextProps.activeChat.id &&
    prevProps.activeChat.contextId === nextProps.activeChat.contextId &&
    prevProps.activeChat.contextIdentity === nextProps.activeChat.contextIdentity &&
    prevProps.activeChat.canJoin === nextProps.activeChat.canJoin &&
    prevProps.activeChat.requiresProfileSetup ===
      nextProps.activeChat.requiresProfileSetup &&
    prevProps.incomingMessages === nextProps.incomingMessages &&
    prevProps.incomingThreadMessages === nextProps.incomingThreadMessages &&
    prevProps.openThread?.id === nextProps.openThread?.id &&
    prevProps.searchResults === nextProps.searchResults &&
    prevProps.searchQuery === nextProps.searchQuery &&
    prevProps.isSearchingMessages === nextProps.isSearchingMessages &&
    prevProps.searchHasMore === nextProps.searchHasMore &&
    prevProps.searchError === nextProps.searchError &&
    prevProps.isSearchOverlayOpen === nextProps.isSearchOverlayOpen &&
    prevProps.focusMessageId === nextProps.focusMessageId &&
    prevProps.reloadKey === nextProps.reloadKey &&
    prevProps.onJumpToPresent === nextProps.onJumpToPresent &&
    prevProps.copyMessageLink === nextProps.copyMessageLink
  );
});
