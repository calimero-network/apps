import { useCallback, useEffect, useState } from "react";
import AppContainer from "../../components/common/AppContainer";
import {
  MessageStatus,
  type ActiveChat,
  type ChannelMeta,
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
import type { Channels, FullMessageResponse, Message, UserId } from "../../api/clientApi";
import type { Message as ApiMessage } from "../../api/clientApi";

import { type SubscriptionsClient } from "@calimero-network/calimero-client";

export default function Home() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<UserId[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);

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

  useEffect(() => {
    let subscriptionsClient: SubscriptionsClient | null = null;
    
    const observeNodeEvents = async () => {
      try {
        subscriptionsClient = getWsSubscriptionsClient();
        await subscriptionsClient.connect();
        subscriptionsClient.subscribe([contextId]);

        subscriptionsClient?.addCallback(async (data: NodeEvent) => {
          try {
            if (data.type === "StateMutation") {
              //TODO FIX LOGIC
            } else if (data.type === "ExecutionEvent") {
              console.log("execution event: ", data);
              // e.g. Message sent event
              const executionEvents = data.data.events;
              for (const event of executionEvents) {
                if (event.kind === "MessageSent") {
                  const messageDataArray: number[] = event.data;
                  const messageData = new Uint8Array(messageDataArray);
                  const message: Message = JSON.parse(new TextDecoder().decode(messageData));
                  const newMessage: CurbMessage = {
                    id: message.id,
                    text: message.text,
                    nonce: Math.random().toString(36).substring(2, 15),
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
                  };
                  setIncomingMessages([newMessage]);
                } else if (event.kind === "ChannelCreated") {
                  const channelCreatedDataArray: number[] = event.data;
                  const data = new Uint8Array(channelCreatedDataArray);
                  const result: Message = JSON.parse(new TextDecoder().decode(data));
                  console.log("channel created: ", result);
                  await fetchChannels();
                }
              } 
            }
          } catch (callbackError) {
            console.error("Error in subscription callback:", callbackError);
          }
        });
      } catch (error) {
        console.error("Error in node websocket:", error);
      }
    };

    observeNodeEvents();

    // Cleanup function to disconnect when component unmounts
    return () => {
      if (subscriptionsClient) {
        subscriptionsClient.disconnect();
      }
    };
  }, []); // Remove activeChat dependency - subscription should be global

  const loadInitialChatMessages = async (
  ): Promise<ChatMessagesData> => {
    if (!activeChat?.name) {
      return {
        messages: [],
        totalCount: 0,
        hasMore: false,
      };
    }
    const messages: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: activeChat?.name || "" },
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map((message: ApiMessage) => ({
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

  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [users, _setUsers] = useState<User[]>([]);

  const fetchChannels = async () => {
    const channels: ResponseData<Channels> =
      await new ClientApiDataSource().getChannels();
    if (channels.data) {
      const channelsArray: ChannelMeta[] = Object.entries(channels.data).map(
        ([name, channelInfo]) => ({
          name,
          type: "channel" as const,
          channelType: channelInfo.channel_type,
          description: "",
          owner: channelInfo.created_by,
          members: [],
          createdBy: channelInfo.created_by,
          inviteOnly: false,
          unreadMessages: {
            count: 0,
            mentions: 0,
          },
          isMember: false,
          readOnly: channelInfo.read_only,
          createdAt: new Date(channelInfo.created_at * 1000).toISOString(),
        })
      );
      setChannels(channelsArray);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

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
      channels={channels}
      users={users}
    />
  );
}
