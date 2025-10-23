import { useCallback, useEffect, useRef, useState, memo } from "react";
import { styled } from "styled-components";
import { StorageHelper } from "../utils/storage";
import { log } from "../utils/logger";
import type {
  ActiveChat,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  CurbMessage,
  UpdatedMessages,
} from "../types/Common";
import { DMSetupState, MessageStatus } from "../types/Common";
import JoinChannel from "./JoinChannel";
import ChatDisplaySplit from "./ChatDisplaySplit";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import {
  apiClient,
  getExecutorPublicKey,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type { ChannelInfo, DMChatInfo, UserId } from "../api/clientApi";
import HandleDMSetup from "./HandleDMSetup";
import HandleInvitation from "./HandleInvitation";
import JoinContext from "./JoinContext";
import InvitationPending from "./InvitationPending";
import { getDMSetupState } from "../utils/dmSetupState";
import SyncWaiting from "./SyncWaiting";
import { extractAndAddMentions } from "../utils/mentions";

interface ChatContainerProps {
  activeChat: ActiveChat;
  setIsOpenSearchChannel: () => void;
  onJoinedChat: () => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  loadInitialThreadMessages: (
    parentMessageId: string,
  ) => Promise<ChatMessagesData>;
  incomingThreadMessages: CurbMessage[];
  loadPrevThreadMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  updateCurrentOpenThread: (thread: CurbMessage | undefined) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (thread: CurbMessage | undefined) => void;
  currentOpenThreadRef: React.RefObject<CurbMessage | undefined>;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
  membersList: Map<string, string>;
  addOptimisticMessage?: (message: CurbMessage) => void;
  addOptimisticThreadMessage?: (message: CurbMessage) => void;
}

const ChatContainerWrapper = styled.div`
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
    border-left: none;
    position: fixed;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 30;
    background-color: #0e0e10;
  }
`;

function ChatContainer({
  activeChat,
  setIsOpenSearchChannel,
  onJoinedChat,
  loadInitialChatMessages,
  incomingMessages,
  loadPrevMessages,
  loadInitialThreadMessages,
  incomingThreadMessages,
  loadPrevThreadMessages,
  updateCurrentOpenThread,
  openThread,
  setOpenThread,
  currentOpenThreadRef,
  onDMSelected,
  membersList,
  addOptimisticMessage,
  addOptimisticThreadMessage,
}: ChatContainerProps) {
  const [updatedMessages, setUpdatedMessages] = useState<UpdatedMessages[]>([]);
  const [_updatedThreadMessages, setUpdatedThreadMessages] = useState<
    UpdatedMessages[]
  >([]);
  const [isEmojiSelectorVisible, setIsEmojiSelectorVisible] = useState(false);
  const [channelMeta, setChannelMeta] = useState<ChannelInfo>(
    {} as ChannelInfo,
  );
  const [openMobileReactions, setOpenMobileReactions] = useState("");
  const [messageWithEmojiSelector, setMessageWithEmojiSelector] =
    useState<CurbMessage | null>(null);

  // Track last fetched channel to prevent excessive API calls
  const lastFetchedChannelRef = useRef<string>("");

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

  const computeReaction = useCallback(
    (message: CurbMessage, reaction: string, username: string) => {
      const accounts = message.reactions?.[reaction] ?? [];
      let update;
      if (accounts.includes(username)) {
        update = accounts.filter((a: string) => a !== username);
      } else {
        update = [...accounts, username];
      }
      return { reactions: { ...message.reactions, [reaction]: update } };
    },
    [],
  );

  const handleReaction = useCallback(
    async (message: CurbMessage, reaction: string, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const username = StorageHelper.getItem("chat-username") || "";
      const accounts = message.reactions?.[reaction] ?? [];
      const isAdding = !(
        Array.isArray(accounts) && accounts.includes(username)
      );

      try {
        const response = await new ClientApiDataSource().updateReaction({
          messageId: message.id,
          emoji: reaction,
          userId: username,
          add: isAdding,
          is_dm: isDM,
          dm_identity: activeChatRef.current?.account,
        });
        if (response.data) {
          const updateFunction = (message: CurbMessage) =>
            computeReaction(message, reaction, username);
          if (isThread) {
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
    [computeReaction],
  );

  const getIconFromCache = useCallback(
    (_accountId: string): Promise<string | null> => {
      const fallbackImage = "https://i.imgur.com/e8buxpa.png";
      return Promise.resolve(fallbackImage);
    },
    [],
  );

  const toggleEmojiSelector = useCallback(
    (message: CurbMessage) => {
      setMessageWithEmojiSelector(message);
      setIsEmojiSelectorVisible((prev) => !prev);
    },
    [setIsEmojiSelectorVisible],
  );

  const sendMessage = async (message: string, isThread: boolean) => {
    log.debug(
      "ChatContainer",
      `sendMessage called with message: "${message}", isThread: ${isThread}`,
    );
    log.debug(
      "ChatContainer",
      `addOptimisticMessage: ${addOptimisticMessage ? "provided" : "missing"}`,
    );
    log.debug(
      "ChatContainer",
      `addOptimisticThreadMessage: ${addOptimisticThreadMessage ? "provided" : "missing"}`,
    );
    const isDM = activeChatRef.current?.type === "direct_message";

    const result = extractAndAddMentions(message, membersListRef.current);

    const mentions: UserId[] = [...result.userIdMentions];
    const usernames: string[] = [...result.usernameMentions];

    // Add optimistic message immediately (if function is provided)
    const optimisticFunction = isThread
      ? addOptimisticThreadMessage
      : addOptimisticMessage;
    log.debug(
      "ChatContainer",
      `sendMessage called - isThread: ${isThread}, optimisticFunction: ${optimisticFunction ? "provided" : "missing"}`,
    );
    if (optimisticFunction) {
      // For DMs, use the DM-specific identity (activeChat.account)
      // For Channels, use the main identity (getExecutorPublicKey)
      const sender = isDM
        ? activeChatRef.current?.account || getExecutorPublicKey() || ""
        : getExecutorPublicKey() || "";

      const optimisticMessage: CurbMessage = {
        id: `temp-${Date.now()}`,
        text: message,
        nonce: Math.random().toString(36).substring(2, 15),
        key: `temp-${Date.now()}`,
        timestamp: Date.now(),
        sender: sender,
        senderUsername: StorageHelper.getItem("chat-username") || undefined,
        reactions: {},
        editedOn: undefined,
        mentions: mentions,
        files: [],
        images: [],
        editMode: false,
        status: MessageStatus.sent,
        deleted: false,
      };
      try {
        log.debug(
          "ChatContainer",
          `Adding optimistic ${isThread ? "thread" : "main"} message:`,
          optimisticMessage,
        );
        optimisticFunction(optimisticMessage);
        log.debug(
          "ChatContainer",
          `Optimistic ${isThread ? "thread" : "main"} message added successfully`,
        );
      } catch (error) {
        log.error("ChatContainer", "Error adding optimistic message", error);
      }
    }

    const parentMessageId = isThread
      ? currentOpenThreadRef.current?.key || currentOpenThreadRef.current?.id
      : undefined;
    if (isThread) {
      log.debug(
        "ChatContainer",
        `Sending thread message with parent_message: ${parentMessageId}`,
      );
      log.debug("ChatContainer", `currentOpenThreadRef.current:`, {
        id: currentOpenThreadRef.current?.id,
        key: currentOpenThreadRef.current?.key,
        text: currentOpenThreadRef.current?.text,
      });
    }

    await new ClientApiDataSource().sendMessage({
      group: {
        name: (isDM ? "private_dm" : activeChatRef.current?.name) ?? "",
      },
      message,
      mentions,
      usernames,
      timestamp: Math.floor(Date.now() / 1000),
      is_dm: isDM,
      dm_identity: activeChatRef.current?.account,
      parent_message: parentMessageId,
    });

    if (isDM) {
      const fetchContextResponse = await apiClient
        .node()
        .getContext(activeChatRef.current?.contextId || "");
      await new ClientApiDataSource().updateDmHash({
        sender_id: getExecutorPublicKey() || "",
        other_user_id: activeChatRef.current?.name || "",
        new_hash: (fetchContextResponse.data?.rootHash as string) || "",
      });
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
      const response = await new ClientApiDataSource().deleteMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.account,
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
    [], // Uses refs which don't need to be in dependencies
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
    [], // No external dependencies needed
  );

  const handleEditedMessage = useCallback(
    async (message: CurbMessage, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const editedOn = Math.floor(Date.now() / 1000);
      const response = await new ClientApiDataSource().editMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        newMessage: message.text,
        timestamp: editedOn,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.account,
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
    [], // Uses refs which don't need to be in dependencies
  );

  const selectThread = (message: CurbMessage) => {
    // Extract the real message ID from the key (before any _nonce_version suffix)
    // The key format is: originalId_nonce_version, but we need just the originalId for API calls
    const realMessageId = message.key || message.id;
    log.debug(
      "ChatContainer",
      `Opening thread for message - id: ${message.id}, key: ${message.key}, using: ${realMessageId}`,
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
      `Thread loadInitialChatMessages called with parentMessageId: ${parentMessageId}`,
    );
    return loadInitialThreadMessages(parentMessageId);
  }, [parentMessageId, loadInitialThreadMessages]);

  // Debug logging for thread state
  useEffect(() => {
    if (openThread) {
      log.debug(
        "ChatContainer",
        `Thread component should be visible for message: ${openThread.id}`,
      );
    }
  }, [openThread]);

  const dmSetupState = getDMSetupState(activeChat);

  const renderDMContent = () => {
    switch (dmSetupState) {
      case DMSetupState.CREATOR_WAITING_FOR_INVITEE_TO_CREATE_IDENTITY:
      case DMSetupState.INVITEE_CONTEXT_CREATE_IDENTITY:
        return (
          <HandleDMSetup activeChat={activeChat} onDMSelected={onDMSelected} />
        );
      case DMSetupState.CREATOR_CONTEXT_INVITATION_POPUP:
        return (
          <HandleInvitation
            activeChat={activeChat}
            onDMSelected={onDMSelected}
          />
        );
      case DMSetupState.INVITEE_WAITING_INVITATION:
        return <InvitationPending activeChat={activeChat} />;
      case DMSetupState.INVITEE_CONTEXT_ACCEPT_POPUP:
        return (
          <JoinContext
            activeChat={activeChat}
            invitationPayload={activeChat.invitationPayload!}
            onDMSelected={onDMSelected}
          />
        );
      case DMSetupState.SYNC_WAITING:
        return (
          <SyncWaiting activeChat={activeChat} onDMSelected={onDMSelected} />
        );

      case DMSetupState.ACTIVE:
        return (
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
              sendMessage={(message: string) => sendMessage(message, false)}
              getIconFromCache={getIconFromCache}
              isThread={false}
              isReadOnly={activeChat.readOnly ?? false}
              toggleEmojiSelector={toggleEmojiSelector}
              channelMeta={channelMeta}
              //channelUserList={channelUserList}
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
                  sendMessage={(message: string) => sendMessage(message, true)}
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
                  incomingMessages={(() => {
                    log.debug(
                      "ChatContainer",
                      `Passing incomingThreadMessages to DM thread component:`,
                      incomingThreadMessages,
                    );
                    return incomingThreadMessages;
                  })()}
                  loadPrevMessages={(id: string) => loadPrevThreadMessages(id)}
                  currentOpenThreadRef={currentOpenThreadRef}
                  isEmojiSelectorVisible={isEmojiSelectorVisible}
                  setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
                  messageWithEmojiSelector={messageWithEmojiSelector}
                />
              </ThreadWrapper>
            )}
          </>
        );

      default:
        return null;
    }
  };

  return (
    <ChatContainerWrapper>
      {activeChat.type === "direct_message" ? (
        renderDMContent()
      ) : (
        <>
          {activeChat.canJoin ? (
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
                sendMessage={(message: string) => sendMessage(message, false)}
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
                    sendMessage={(message: string) =>
                      sendMessage(message, true)
                    }
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
                    loadInitialChatMessages={() => {
                      log.debug(
                        "ChatContainer",
                        `Thread loadInitialChatMessages called with openThread.id: ${openThread.id}`,
                      );
                      return loadInitialThreadMessages(openThread.id);
                    }}
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
        </>
      )}
    </ChatContainerWrapper>
  );
}

// Custom comparison to prevent re-renders when only function references change
export default memo(ChatContainer, (prevProps, nextProps) => {
  // Re-render only if these key values actually change
  return (
    prevProps.activeChat.id === nextProps.activeChat.id &&
    prevProps.activeChat.contextId === nextProps.activeChat.contextId &&
    prevProps.incomingMessages === nextProps.incomingMessages &&
    prevProps.incomingThreadMessages === nextProps.incomingThreadMessages &&
    prevProps.openThread?.id === nextProps.openThread?.id
  );
});
