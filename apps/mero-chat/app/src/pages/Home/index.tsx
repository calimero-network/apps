import { useCallback, useEffect, useState } from "react";
import AppContainer from "../../components/common/AppContainer";
import {
  MessageStatus,
  type ActiveChat,
  type ChatMessagesData,
  type CurbMessage,
  type User,
} from "../../types/Common";
import { getStoredSession, updateSessionChat } from "../../utils/session";
import { defaultActiveChat } from "../../mock/mock";
import {
  ClientApiDataSource,
  contextId,
  getWsSubscriptionsClient,
} from "../../api/dataSource/clientApiDataSource";
import {
  type NodeEvent,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type { UserId } from "../../api/clientApi";
import type { Message as ApiMessage } from "../../api/clientApi";

import { type SubscriptionsClient } from "@calimero-network/calimero-client";

export default function Home() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<UserId[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [initialMessages, setInitialMessages] = useState<CurbMessage[]>([]);

  const getChannelUsers = async (channelId: string) => {
    const channelUsers: ResponseData<UserId[]> =
      await new ClientApiDataSource().getChannelMembers({
        channel: { name: channelId },
      });
    if (channelUsers.data) {
      setChannelUsers(channelUsers.data);
    }
  };

  const updateSelectedActiveChat = (selectedChat: ActiveChat) => {
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    getChannelUsers(selectedChat.id);
    setIsSidebarOpen(false);
    updateSessionChat(selectedChat);
  };

  const openSearchPage = useCallback(() => {
    setIsOpenSearchChannel(true);
    setIsSidebarOpen(false);
    setActiveChat(null);
  }, []);

  useEffect(() => {
    const storedSession: ActiveChat | null = getStoredSession();
    if (storedSession) {
      setActiveChat(storedSession);
    } else {
      setActiveChat(defaultActiveChat);
    }
    getChannelUsers(activeChat?.name || "");
  }, []);

  const onDMSelected = useCallback((dm: User) => {
    setActiveChat({
      type: "direct_message",
      name: dm.id,
      id: dm.id,
    });
  }, []);

  const observeNodeEvents = async () => {
    try {
      const subscriptionsClient: SubscriptionsClient =
        getWsSubscriptionsClient();
      await subscriptionsClient.connect();
      subscriptionsClient.subscribe([contextId]);

      subscriptionsClient?.addCallback(async (data: NodeEvent) => {
        try {
          if (data.type === "StateMutation") {
            //TODO FIX LOGIC
          }
        } catch (callbackError) {
          console.error("Error in subscription callback:", callbackError);
        }
      });
    } catch (error) {
      console.error("Error in node websocket:", error);
    }
  };

  const loadInitialChatMessages = async (
  ): Promise<ChatMessagesData> => {
    console.log("chat selected:", activeChat);
    if (!activeChat?.name) {
      return {
        messages: [],
        totalCount: 0,
        hasMore: false,
      };
    }
    const messages: ResponseData<ApiMessage[]> =
      await new ClientApiDataSource().getMessages({
        group: { name: activeChat?.name || "" },
      });
    if (messages.data) {
      const messagesArray = messages.data.map((message: ApiMessage) => ({
        id: message.id,
        text: message.text,
        nonce: "1234567890",
        key: Math.random().toString(36).substring(2, 15),
        timestamp: message.timestamp * 1000,
        sender: message.sender,
        reactions: {},
        threadCount: 0,
        threadLastTimestamp: 0,
        editedOn: undefined,
        mentions: [],
        files: [],
        images: [],
        editMode: false,
        status: MessageStatus.sent,
      }));

      return {
        messages: messagesArray,
        totalCount: messagesArray.length,
        hasMore: false,
      };
    }
    return {
      messages: [],
      totalCount: 0,
      hasMore: false,
    };
  };

  useEffect(() => {
    observeNodeEvents();
  }, [activeChat]);

  return (
    <AppContainer
      isOpenSearchChannel={isOpenSearchChannel}
      setIsOpenSearchChannel={setIsOpenSearchChannel}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      activeChat={activeChat}
      updateSelectedActiveChat={updateSelectedActiveChat}
      openSearchPage={openSearchPage}
      channelUsers={channelUsers}
      onDMSelected={onDMSelected}
      loadInitialChatMessages={loadInitialChatMessages}
      incomingMessages={incomingMessages}
    />
  );
}
