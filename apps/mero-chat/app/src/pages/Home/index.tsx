import { useCallback, useEffect, useState, useRef } from "react";
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
  getWsSubscriptionsClient,
} from "../../api/dataSource/clientApiDataSource";
import {
  type NodeEvent,
  type ResponseData,
  getContextId,
} from "@calimero-network/calimero-client";
import type {
  Channels,
  FullMessageResponse,
  UserId,
} from "../../api/clientApi";
import type { Message as ApiMessage } from "../../api/clientApi";

import { type SubscriptionsClient } from "@calimero-network/calimero-client";

export default function Home() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<UserId[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [nonInvitedUserList, setNonInvitedUserList] = useState<UserId[]>([]);
  const messagesRef = useRef<CurbMessage[]>([]);
  const activeChatRef = useRef<ActiveChat | null>(null);

  const getChannelUsers = async (channelId: string) => {
    const channelUsers: ResponseData<UserId[]> =
      await new ClientApiDataSource().getChannelMembers({
        channel: { name: channelId },
      });
    if (channelUsers.data) {
      setChannelUsers(channelUsers.data);
    }
  };

  const reFetchChannelMembers = async () => {
    await getChannelUsers(activeChatRef.current?.id || "");
  };

  const getNonInvitedUsers = async (channelId: string) => {
    const nonInvitedUsers: ResponseData<UserId[]> =
      await new ClientApiDataSource().getNonMemberUsers({
        channel: { name: channelId },
      });
    if (nonInvitedUsers.data) {
      setNonInvitedUserList(nonInvitedUsers.data);
    }
  };

  const updateSelectedActiveChat = (selectedChat: ActiveChat) => {
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    activeChatRef.current = selectedChat;
    getChannelUsers(selectedChat.id);
    getNonInvitedUsers(selectedChat.id);
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
    const chatToUse = storedSession || defaultActiveChat;

    setActiveChat(chatToUse);
    activeChatRef.current = chatToUse;
    getChannelUsers(chatToUse.name);
    getNonInvitedUsers(chatToUse.name);
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
        subscriptionsClient.subscribe([getContextId() || ""]);

        subscriptionsClient?.addCallback(async (data: NodeEvent) => {
          try {
            if (data.type === "StateMutation") {
              //TODO FIX LOGIC
              const reFetchedMessages: ResponseData<FullMessageResponse> =
                await new ClientApiDataSource().getMessages({
                  group: { name: activeChatRef.current?.name || "" },
                });
              if (reFetchedMessages.data) {
                const existingMessageIds = new Set(
                  messagesRef.current.map((msg) => msg.id)
                );
                const newMessages = reFetchedMessages.data.messages
                  .filter(
                    (message: ApiMessage) => !existingMessageIds.has(message.id)
                  )
                  .map((message: ApiMessage) => ({
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
                  }));

                if (newMessages.length > 0) {
                  setIncomingMessages(newMessages);
                  messagesRef.current = [
                    ...messagesRef.current,
                    ...newMessages,
                  ];
                }
              }
            } else if (data.type === "ExecutionEvent") {
              const executionEvents = data.data.events;
              for (const event of executionEvents) {
                if (event.kind === "MessageSent") {
                  // On sender node do nothing as this will only duplicate the message
                } else if (event.kind === "ChannelCreated") {
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

    return () => {
      if (subscriptionsClient) {
        subscriptionsClient.disconnect();
      }
    };
  }, []);

  const loadInitialChatMessages = async (): Promise<ChatMessagesData> => {
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
      const messagesArray = messages.data.messages.map(
        (message: ApiMessage) => ({
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
        })
      );

      messagesRef.current = messagesArray;
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

  const onJoinedChat = async () => {
    await fetchChannels();
    const activeChatCopy = {...activeChat};
    if (activeChatCopy && activeChat) {
      activeChatCopy.canJoin = false;
      activeChatCopy.type = activeChat.type;
      activeChatCopy.id = activeChat.id;
      activeChatCopy.name = activeChat.name;
      activeChatCopy.readOnly = activeChat.readOnly;
      activeChatCopy.account = activeChat.account;
    }
    setActiveChat(activeChatCopy as ActiveChat);
    activeChatRef.current = activeChatCopy as ActiveChat;
  }

  return (
    <AppContainer
      isOpenSearchChannel={isOpenSearchChannel}
      setIsOpenSearchChannel={setIsOpenSearchChannel}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      activeChat={activeChat}
      updateSelectedActiveChat={updateSelectedActiveChat}
      reFetchChannelMembers={reFetchChannelMembers}
      openSearchPage={openSearchPage}
      channelUsers={channelUsers}
      nonInvitedUserList={nonInvitedUserList}
      onDMSelected={onDMSelected}
      loadInitialChatMessages={loadInitialChatMessages}
      incomingMessages={incomingMessages}
      channels={channels}
      users={users}
      fetchChannels={fetchChannels}
      onJoinedChat={onJoinedChat}
    />
  );
}
