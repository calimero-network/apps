import { styled } from "styled-components";
import { type MessageWithReactions, type User } from "../types/Common";
import type {
  ActiveChat,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  MessageRendererProps,
  UpdatedMessages,
} from "../types/Common";
import { useEffect, useMemo, useState } from "react";
import MessageInput from "./MessageInput";
import {
  messageRenderer,
  VirtualizedChat,
  type CurbMessage,
} from "curb-virtualized-chat";
import type { ChannelInfo } from "../api/clientApi";
import { getExecutorPublicKey } from "@calimero-network/calimero-client";
import EmojiSelectorPopup from "../emojiSelector/EmojiSelectorPopup";

interface ChatDisplaySplitProps {
  readMessage: (message: MessageWithReactions) => void;
  handleReaction: (
    message: CurbMessage,
    emoji: string,
    isThread: boolean
  ) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (message: CurbMessage) => void;
  activeChat: ActiveChat;
  updatedMessages: UpdatedMessages[];
  resetImage: () => void;
  sendMessage: (message: string) => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  isThread: boolean;
  isReadOnly: boolean;
  toggleEmojiSelector: (message: CurbMessage) => void;
  channelMeta: ChannelInfo;
  channelUserList: User[];
  setOpenMobileReactions: (reactions: string) => void;
  openMobileReactions: string;
  onMessageDeletion: (message: CurbMessage) => void;
  onEditModeRequested: (message: CurbMessage, isThread: boolean) => void;
  onEditModeCancelled: (message: CurbMessage) => void;
  onMessageUpdated: (message: CurbMessage) => void;
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
    height: calc(100vh - 130px) !important;
    padding-left: 0px !important;
    padding-right: 0px !important;
  }
  scrollbar-color: black black;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  html::-webkit-scrollbar {
    width: 12px;
  }
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;

const ThreadTitle = styled.div`
  color: #fff;
  font-size: 24px;
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
  paddingBottom: "2.5rem",
  scrollBehavior: "smooth",
  height: "calc(100vh - 173px)",
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

export default function ChatDisplaySplit({
  readMessage,
  handleReaction,
  openThread,
  setOpenThread,
  activeChat,
  updatedMessages,
  resetImage,
  sendMessage,
  getIconFromCache,
  isThread,
  isReadOnly,
  toggleEmojiSelector,
  channelMeta,
  channelUserList,
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

  useEffect(() => {
    if (!accountId) {
      setAccountId(getExecutorPublicKey() ?? "");
    }
  }, []);

  const isModerator = useMemo(
    () =>
      channelUserList?.some(
        (user) => user.id === accountId && user.moderator === true
      ),
    [channelUserList, accountId]
  );

  const isOwner = accountId === channelMeta.created_by;

  // Create mutable copies of the style objects
  const currentChatStyle = { ...chatStyle };
  const currentContainerPaddingStyle = { ...containerPaddingStyle };
  const currentWrapperStyle = { ...wrapperStyle };

  if (openThread && isThread) {
    currentChatStyle.height = "calc(100% - 124px)";
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

  const renderMessage = () => {
    const params: MessageRendererProps = {
      accountId: "fran.near",
      isThread: isThread,
      handleReaction: (message: CurbMessage, reaction: string) =>
        handleReaction(message, reaction, isThread),
      setThread: setOpenThread,
      getIconFromCache: getIconFromCache,
      toggleEmojiSelector: toggleEmojiSelector,
      openMobileReactions: openMobileReactions,
      setOpenMobileReactions: setOpenMobileReactions,
      editable: (_message: CurbMessage) => true,
      deleteable: (_message: CurbMessage) => true,
      onEditModeRequested: onEditModeRequested,
      onEditModeCancelled: onEditModeCancelled,
      onMessageUpdated: onMessageUpdated,
      onDeleteMessageRequested: onMessageDeletion,
      fetchAccounts: (_prefix: string) => {},
      autocompleteAccounts: [],
      authToken: undefined,
      privateIpfsEndpoint: "https://ipfs.io",
    };
    return messageRenderer(params);
  };

  return (
    <>
      <Wrapper style={currentWrapperStyle}>
        {/* @ts-expect-error - TODO: fix this */}
        <ContainerPadding style={currentContainerPaddingStyle}>
          {openThread && isThread && (
            <ThreadHeader
              onClose={() => {
                setOpenThread("");
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
            shouldTriggerNewItemIndicator={(message: MessageWithReactions) =>
              message.sender !== accountId
            }
            render={renderMessage()}
            chatId={isThread ? openThread?.id : activeChat}
            style={currentChatStyle}
          />
        </ContainerPadding>
        <MessageInput
          selectedChat={
            activeChat.type === "channel" ? activeChat.name : activeChat.username || ""
          }
          sendMessage={sendMessage}
          resetImage={resetImage}
          openThread={openThread}
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
}
