import { styled } from "styled-components";
import { type MessageWithReactions, type User } from "../types/Common";
import type {
  ActiveChat,
  ChatMessagesData,
  MessageRendererProps,
} from "../types/Common";
import { useCallback, useEffect, useMemo, useState } from "react";
import MessageInput from "./MessageInput";
import {
  messageRenderer,
  VirtualizedChat,
  type CurbMessage,
} from "virtualized-chat";
import type { ChannelInfo } from "../api/clientApi";
import { getExecutorPublicKey } from "@calimero-network/calimero-client";

interface ChatDisplaySplitProps {
  readMessage: (message: MessageWithReactions) => void;
  handleReaction: (message: MessageWithReactions, emoji: string) => void;
  openThread: MessageWithReactions | undefined;
  setOpenThread: (message: MessageWithReactions | null) => void;
  activeChat: ActiveChat;
  updatedMessages: MessageWithReactions[];
  resetImage: () => void;
  sendMessage: (message: string) => void;
  getIconFromCache: (icon: string) => string;
  isThread: boolean;
  isReadOnly: boolean;
  toggleEmojiSelector: () => void;
  channelMeta: ChannelInfo;
  channelUserList: User[];
  setOpenMobileReactions: (reactions: string) => void;
  openMobileReactions: string;
  onMessageDeletion: (message: MessageWithReactions) => void;
  onEditModeRequested: (message: MessageWithReactions) => void;
  onEditModeCancelled: (message: MessageWithReactions) => void;
  onMessageUpdated: (message: MessageWithReactions) => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
}

const ContainerPadding = styled.div`
  @media (max-width: 1024px) {
    height: calc(100vh - 160px) !important;
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
}: ChatDisplaySplitProps) {
  const [accountId, setAccountId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!accountId) {
      setAccountId(getExecutorPublicKey() ?? "");
    }
  }, []);

  const _loadPrevMessages = (id: string) => {
    console.log(id);
    // TODO: pagination
    // if (isThread && id) {
    //   return curbApi.fetchMessages({
    //     chat: activeChat,
    //     beforeId: id,
    //     limit: 20,
    //     parentMessageId: openThread.id,
    //   });
    // }
    // return curbApi.fetchMessages({ chat: activeChat, beforeId: id, limit: 20 });
  };

  const setThread = useCallback((message: CurbMessage) => {
    setOpenThread(message);
  }, []);

  const isModerator = useMemo(
    () =>
      channelUserList?.some(
        (user) => user.id === accountId && user.moderator === true
      ),
    [channelUserList, accountId]
  );

  const isOwner = accountId === channelMeta.created_by;

  if (openThread && isThread) {
    chatStyle.height = "calc(100% - 124px)";
    chatStyle.width = "100%";
    chatStyle.overflow = "hidden";
    containerPaddingStyle.flexDirection = "column";
    containerPaddingStyle.paddingLeft = "0px";
    containerPaddingStyle.height = "100%";
    containerPaddingStyle.width = "100%";
    wrapperStyle.width = "100%";
  } else if (openThread && !isThread) {
    chatStyle.height = "100%";
    chatStyle.width = "100%";
    containerPaddingStyle.paddingRight = "0px";
    wrapperStyle.width = "60%";
  } else {
    chatStyle.height = "100%";
    chatStyle.width = "100%";
    chatStyle["overflow"] = "hidden";
  }

  const loadPrevMessagesMock = async () => {
    return {
      messages: [],
      hasMore: false,
    };
  };

  const renderMessage = () => {
    const params: MessageRendererProps = {
      accountId: "fran.near",
      isThread: false,
      handleReaction: (message: CurbMessage, reaction: string) => {
        console.log(message, reaction);
      },
      setThread: setThread,
      getIconFromCache: (_accountId: string) => Promise.resolve(null),
      toggleEmojiSelector: (_message: CurbMessage) => {},
      openMobileReactions: "abc",
      setOpenMobileReactions: (_messageId: string) => {},
      editable: (_message: CurbMessage) => true,
      deleteable: (_message: CurbMessage) => true,
      onEditModeRequested: (_message: CurbMessage, _isThread: boolean) => {},
      onEditModeCancelled: (_message: CurbMessage) => {},
      onMessageUpdated: (_message: CurbMessage) => {},
      onDeleteMessageRequested: (_message: CurbMessage) => {},
      fetchAccounts: (_prefix: string) => {},
      autocompleteAccounts: [],
      authToken: undefined,
      privateIpfsEndpoint: "https://ipfs.io",
    };
    return messageRenderer(params);
  };

  return (
    <Wrapper style={wrapperStyle}>
      {/* @ts-expect-error - TODO: fix this */}
      <ContainerPadding style={containerPaddingStyle}>
        {openThread && isThread && (
          <ThreadHeader onClose={() => setOpenThread(null)} />
        )}
        <VirtualizedChat
          loadInitialMessages={loadInitialChatMessages}
          loadPrevMessages={loadPrevMessagesMock}
          incomingMessages={incomingMessages}
          updatedMessages={updatedMessages}
          onItemNewItemRender={readMessage}
          shouldTriggerNewItemIndicator={(message: MessageWithReactions) =>
            message.sender !== accountId
          }
          render={renderMessage()}
          chatId={isThread ? openThread?.id : activeChat}
          style={chatStyle}
        />
      </ContainerPadding>
      <MessageInput
        selectedChat={
          activeChat.type === "channel" ? activeChat.name : activeChat.id
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
  );
}
