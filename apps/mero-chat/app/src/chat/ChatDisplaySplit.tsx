import { styled } from "styled-components";
import type {
  ActiveChat,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  MessageRendererProps,
  UpdatedMessages,
} from "../types/Common";
import { useEffect, useState, useRef, memo } from "react";
import MessageInput from "./MessageInput";
import {
  messageRenderer,
  VirtualizedChat,
  type CurbMessage,
} from "../components/virtualized-chat";
import type { ChannelInfo } from "../api/clientApi";
import { getExecutorPublicKey } from "@calimero-network/calimero-client";
import EmojiSelectorPopup from "../emojiSelector/EmojiSelectorPopup";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { scrollbarStyles } from "../styles/scrollbar";
import { StorageHelper } from "../utils/storage";
import { log } from "../utils/logger";

interface ChatDisplaySplitProps {
  readMessage: (message: CurbMessage) => void;
  handleReaction: (
    message: CurbMessage,
    emoji: string,
    isThread: boolean,
  ) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (message: CurbMessage) => void;
  closeThread?: () => void;
  activeChat: ActiveChat;
  updatedMessages: UpdatedMessages[];
  resetImage: () => void;
  sendMessage: (message: string) => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  isThread: boolean;
  isReadOnly: boolean;
  toggleEmojiSelector: (message: CurbMessage) => void;
  channelMeta: ChannelInfo;
  //channelUserList: User[];
  setOpenMobileReactions: (reactions: string) => void;
  openMobileReactions: string;
  onMessageDeletion: (message: CurbMessage, isThread: boolean) => void;
  onEditModeRequested: (message: CurbMessage, isThread: boolean) => void;
  onEditModeCancelled: (message: CurbMessage, isThread: boolean) => void;
  onMessageUpdated: (message: CurbMessage, isThread: boolean) => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  currentOpenThreadRef?: React.RefObject<CurbMessage | undefined>;
  isEmojiSelectorVisible: boolean;
  setIsEmojiSelectorVisible: (isVisible: boolean) => void;
  messageWithEmojiSelector: CurbMessage | null;
}

const ContainerPadding = styled.div`
  @media (max-width: 1024px) {
    height: calc(100dvh - 234px) !important;
    padding-left: 0px !important;
    padding-right: 0px !important;
  }

  /* Apply shared scrollbar styles */
  ${scrollbarStyles}

  /* Optimize scrolling performance */
  contain: layout style paint;
  overflow-anchor: none;
`;

const ThreadTitle = styled.div`
  color: #fff;
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%;
`;

const ThreadContainer = styled.div`
  position: relative;
  padding-bottom: 20px;
  border-bottom: 2px solid #282933;
  display: flex;
  justify-content: space-between;
  @media (max-width: 1024px) {
    margin-right: 16px;
    margin-left: 16px;
    padding-top: 42px;
  }
`;

const CloseSvg = styled.svg`
  fill: #777583;
  :hover {
    fill: #fff;
  }
  cursor: pointer;
`;

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100% - 20px);
  /* GPU acceleration for smoother rendering */
  transform: translateZ(0);
  backface-visibility: hidden;

  @media (max-width: 1024px) {
    width: 100% !important;
  }
`;

const containerPaddingStyle = {
  display: "flex",
  flexDirection: "row",
  paddingTop: "1rem",
  paddingLeft: "2.5rem",
  paddingRight: "2.5rem",
  paddingBottom: "0px",
  scrollBehavior: "smooth",
  height: "100%",
  width: "",
};
const chatStyle = {
  height: "",
  width: "",
  overflow: "",
};

const wrapperStyle = {
  height: "100%",
  width: "100%",
  overflow: "",
};

const CloseButtonSvg = ({ onClose }: { onClose: () => void }) => (
  <CloseSvg
    onClick={onClose}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    className="bi bi-x-circle"
    viewBox="0 0 16 16"
  >
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
  </CloseSvg>
);

const ThreadHeader = ({ onClose }: { onClose: () => void }) => (
  <ThreadContainer>
    <ThreadTitle>Thread</ThreadTitle>
    <CloseButtonSvg onClose={onClose} />
  </ThreadContainer>
);

const ChatDisplaySplit = memo(function ChatDisplaySplit({
  readMessage,
  handleReaction,
  openThread,
  setOpenThread,
  closeThread,
  activeChat,
  updatedMessages,
  resetImage,
  sendMessage,
  getIconFromCache,
  isThread,
  isReadOnly,
  toggleEmojiSelector,
  channelMeta,
  //channelUserList,
  setOpenMobileReactions,
  openMobileReactions,
  onMessageDeletion,
  onEditModeRequested,
  onEditModeCancelled,
  onMessageUpdated,
  loadInitialChatMessages,
  incomingMessages,
  loadPrevMessages,
  currentOpenThreadRef,
  isEmojiSelectorVisible,
  setIsEmojiSelectorVisible,
  messageWithEmojiSelector,
}: ChatDisplaySplitProps) {
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [username, setUsername] = useState<string>("");
  const hasLoadedUsername = useRef(false);

  useEffect(() => {
    // Update accountId whenever activeChat changes (DM vs Channel have different IDs)
    const isDM = activeChat?.type === "direct_message";
    const currentAccountId = isDM
      ? activeChat?.account || getExecutorPublicKey() || ""
      : getExecutorPublicKey() || "";
    setAccountId(currentAccountId);

    // Only fetch username once, not on every render
    if (hasLoadedUsername.current) return;

    const setUserInfo = async () => {
      const executorId = getExecutorPublicKey() ?? "";

      // Check if we already have the username in storage
      const cachedUsername = StorageHelper.getItem("chat-username");
      if (cachedUsername) {
        const normalizedClass = cachedUsername
          .replace(/\s+/g, "")
          .toLowerCase()
          .replace(/\./g, "\\.")
          .replace(/_/g, "\\_");
        setUsername(normalizedClass);
        hasLoadedUsername.current = true;
        return;
      }

      // Fetch from API if not cached
      const response = await new ClientApiDataSource().getUsername({
        userId: executorId ?? "",
      });
      if (response.data) {
        const normalizedClass = response.data
          .replace(/\s+/g, "")
          .toLowerCase()
          .replace(/\./g, "\\.")
          .replace(/_/g, "\\_");
        setUsername(normalizedClass);
        hasLoadedUsername.current = true;
      }
    };
    setUserInfo();
  }, [activeChat]);

  // const isModerator = useMemo(
  //   () =>
  //     //channelUserList?.some(
  //     channelMeta.moderators?.some(
  //       (user) => user.id === accountId && user.moderator === true
  //     ),
  //   [channelMeta, accountId]
  // );
  const isModerator = false;

  const isOwner = accountId === channelMeta.created_by;

  const currentChatStyle = { ...chatStyle };
  const currentContainerPaddingStyle = { ...containerPaddingStyle };
  const currentWrapperStyle = { ...wrapperStyle };

  if (openThread && isThread) {
    currentChatStyle.height = "100%";
    currentChatStyle.width = "100%";
    currentChatStyle.overflow = "hidden";
    currentContainerPaddingStyle.flexDirection = "column";
    currentContainerPaddingStyle.paddingLeft = "0px";
    currentContainerPaddingStyle.height = "100%";
    currentContainerPaddingStyle.width = "100%";
    currentWrapperStyle.width = "100%";
  } else if (openThread && !isThread) {
    currentChatStyle.height = "100%";
    currentChatStyle.width = "100%";
    currentContainerPaddingStyle.paddingRight = "0px";
    currentWrapperStyle.width = "60%";
  } else {
    currentChatStyle.height = "100%";
    currentChatStyle.width = "100%";
    currentChatStyle.overflow = "hidden";
  }

  // Debug logging for incomingMessages
  useEffect(() => {
    if (isThread) {
      log.debug(
        "ChatDisplaySplit",
        `Thread component received incomingMessages:`,
        incomingMessages,
      );
    }
  }, [incomingMessages, isThread]);

  const renderMessage = (message: CurbMessage, prevMessage?: CurbMessage) => {
    const params: MessageRendererProps = {
      accountId: username,
      isThread: isThread,
      handleReaction: (message: CurbMessage, reaction: string) =>
        handleReaction(message, reaction, isThread),
      setThread: setOpenThread,
      getIconFromCache: getIconFromCache,
      toggleEmojiSelector: toggleEmojiSelector,
      openMobileReactions: openMobileReactions,
      setOpenMobileReactions: setOpenMobileReactions,
      editable: (message: CurbMessage) =>
        message.sender ===
        (activeChat.type === "direct_message"
          ? activeChat.account
          : getExecutorPublicKey()),
      deleteable: (message: CurbMessage) =>
        message.sender ===
        (activeChat.type === "direct_message"
          ? activeChat.account
          : getExecutorPublicKey()),
      onEditModeRequested: (message: CurbMessage) =>
        onEditModeRequested(message, isThread),
      onEditModeCancelled: (message: CurbMessage) =>
        onEditModeCancelled(message, isThread),
      onMessageUpdated: (message: CurbMessage) =>
        onMessageUpdated(message, isThread),
      onDeleteMessageRequested: (message: CurbMessage) =>
        onMessageDeletion(message, isThread),
      fetchAccounts: (_prefix: string) => {},
      autocompleteAccounts: [],
      authToken: undefined,
      privateIpfsEndpoint: "https://ipfs.io",
    };
    return messageRenderer(params)(message, prevMessage);
  };

  return (
    <>
      <Wrapper style={currentWrapperStyle}>
        {/* @ts-expect-error - TODO: fix this */}
        <ContainerPadding style={currentContainerPaddingStyle}>
          {openThread && isThread && (
            <ThreadHeader
              onClose={() => {
                if (closeThread) {
                  closeThread();
                }
                if (currentOpenThreadRef) {
                  currentOpenThreadRef.current = undefined;
                }
              }}
            />
          )}
          <VirtualizedChat
            loadInitialMessages={loadInitialChatMessages}
            loadPrevMessages={loadPrevMessages}
            incomingMessages={incomingMessages}
            updatedMessages={updatedMessages}
            onItemNewItemRender={readMessage}
            shouldTriggerNewItemIndicator={(message: CurbMessage) =>
              message.sender !== accountId
            }
            render={renderMessage}
            chatId={
              isThread && openThread?.id ? openThread.id : activeChat.id || ""
            }
            style={currentChatStyle}
          />
        </ContainerPadding>
        <MessageInput
          selectedChat={
            activeChat.type === "channel"
              ? activeChat.name
              : activeChat.username || ""
          }
          sendMessage={sendMessage}
          resetImage={resetImage}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          openThread={openThread as any}
          isThread={isThread}
          isReadOnly={isReadOnly}
          isOwner={isOwner}
          isModerator={isModerator}
        />
      </Wrapper>
      {isEmojiSelectorVisible && (
        <EmojiSelectorPopup
          onEmojiSelected={(emoji: string) => {
            handleReaction(messageWithEmojiSelector!, emoji, isThread);
            setIsEmojiSelectorVisible(false);
          }}
          onClose={() => setIsEmojiSelectorVisible(false)}
          key="chat-emojis-component"
        />
      )}
    </>
  );
});

// Custom comparison to prevent re-renders from function reference changes
export default memo(ChatDisplaySplit, (prevProps, nextProps) => {
  // Only re-render if these critical values change
  return (
    prevProps.activeChat.id === nextProps.activeChat.id &&
    prevProps.activeChat.contextId === nextProps.activeChat.contextId &&
    prevProps.incomingMessages === nextProps.incomingMessages &&
    prevProps.updatedMessages === nextProps.updatedMessages &&
    prevProps.openThread?.id === nextProps.openThread?.id &&
    prevProps.isEmojiSelectorVisible === nextProps.isEmojiSelectorVisible &&
    prevProps.openMobileReactions === nextProps.openMobileReactions
  );
});
