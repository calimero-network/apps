import { useCallback, useEffect, useState, useRef } from "react";
import AppContainer from "../../components/common/AppContainer";
import {
  MessageStatus,
  type ActiveChat,
  type ChannelMeta,
  type ChatMessagesData,
  type ChatMessagesDataWithOlder,
  type ChatType,
  type CurbMessage,
} from "../../types/Common";
import {
  getDmContextId,
  getStoredSession,
  setDmContextId,
  updateSessionChat,
} from "../../utils/session";
import { defaultActiveChat } from "../../mock/mock";
import {
  ClientApiDataSource,
  getWsSubscriptionsClient,
} from "../../api/dataSource/clientApiDataSource";
import {
  type NodeEvent,
  type ResponseData,
  getAppEndpointKey,
  getContextId,
  getExecutorPublicKey,
} from "@calimero-network/calimero-client";
import {
  type Channels,
  type DMChatInfo,
  type FullMessageResponse,
  type UserId,
} from "../../api/clientApi";
import type { Message as ApiMessage } from "../../api/clientApi";

import { type SubscriptionsClient } from "@calimero-network/calimero-client";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";

export default function Home() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<UserId[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [nonInvitedUserList, setNonInvitedUserList] = useState<UserId[]>([]);
  const messagesRef = useRef<CurbMessage[]>([]);
  const activeChatRef = useRef<ActiveChat | null>(null);

  useEffect(() => {
    const contextID = getContextId();
    const nodeURL = getAppEndpointKey();
    const identity = getExecutorPublicKey();
    if (!contextID || !nodeURL || !identity) {
      window.location.href = "/login";
    }
  }, []);

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
    setMessagesOffset(20);
    setTotalMessageCount(0);
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
    setMessagesOffset(20);
    setTotalMessageCount(0);
  }, []);

  const onDMSelected = useCallback(async (dm: DMChatInfo) => {
    let canJoin = true;
    const verifyContextResponse =
      await new ContextApiDataSource().verifyContext({
        contextId: dm.context_id,
      });
    if (verifyContextResponse.data) {
      canJoin = !verifyContextResponse.data.joined;
    }
    const selectedChat = {
      type: "direct_message" as ChatType,
      contextId: dm.context_id,
      id: dm.channel_user,
      name: dm.channel_user,
      readOnly: false,
      account: dm.context_identity,
      canJoin: canJoin,
      invitationPayload: dm.invitation_payload,
    };
    setDmContextId(dm.context_id);
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    activeChatRef.current = selectedChat;
    setIsSidebarOpen(false);
    setMessagesOffset(20);
    setTotalMessageCount(0);
  }, []);

  useEffect(() => {
    let subscriptionsClient: SubscriptionsClient | null = null;

    const observeNodeEvents = async () => {
      try {
        subscriptionsClient = getWsSubscriptionsClient();
        await subscriptionsClient.connect();
        subscriptionsClient.subscribe([
          (activeChatRef.current?.type === "direct_message"
            ? getDmContextId()
            : getContextId()) || "",
        ]);

        subscriptionsClient?.addCallback(async (data: NodeEvent) => {
          try {
            if (data.type === "StateMutation") {
              //TODO FIX LOGIC
              const reFetchedMessages: ResponseData<FullMessageResponse> =
                await new ClientApiDataSource().getMessages({
                  group: { name: activeChatRef.current?.name || "" },
                  limit: 20,
                  offset: 0,
                  is_dm: activeChatRef.current?.type === "direct_message",
                  dm_identity: activeChatRef.current?.account,
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
                    key: message.id,
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
  }, [activeChatRef.current?.type, activeChatRef.current?.id]);

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
        limit: 20,
        offset: 0,
        is_dm: activeChat?.type === "direct_message",
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: ApiMessage) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
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
      setTotalMessageCount(messages.data.total_count);
      return {
        messages: messagesArray,
        totalCount: messages.data.total_count,
        hasMore: messages.data.start_position < messages.data.total_count,
      };
    }
    return {
      messages: [],
      totalCount: 0,
      hasMore: false,
    };
  };

  const [channels, setChannels] = useState<ChannelMeta[]>([]);

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

  const [privateDMs, setPrivateDMs] = useState<DMChatInfo[]>([]);

  const fetchDms = async () => {
    const dms: ResponseData<DMChatInfo[]> =
      await new ClientApiDataSource().getDms();
    if (dms.data) {
      setPrivateDMs(dms.data);
    }
  };

  const [chatMembers, setChatMembers] = useState<UserId[]>([]);

  const fetchChatMembers = async () => {
    const chatMembers: ResponseData<UserId[]> =
      await new ClientApiDataSource().getChatMembers();
    if (chatMembers.data) {
      setChatMembers(chatMembers.data);
    }
  };

  useEffect(() => {
    fetchChannels();
    fetchDms();
    fetchChatMembers();
  }, []);

  const onJoinedChat = async () => {
    let canJoin = false;
    if (activeChatRef.current?.type === "direct_message") {
      const joinContextResponse = await new ContextApiDataSource().joinContext({
        invitationPayload: activeChatRef.current?.invitationPayload || "",
      });
      if (joinContextResponse.data) {
        await fetchDms();
      } else {
        canJoin = true;
      }
    } else {
      await fetchChannels();
    }
    const activeChatCopy = { ...activeChat };
    if (activeChatCopy && activeChat) {
      activeChatCopy.canJoin = canJoin;
      activeChatCopy.type = activeChat.type;
      activeChatCopy.id = activeChat.id;
      activeChatCopy.name = activeChat.name;
      activeChatCopy.readOnly = activeChat.readOnly;
      activeChatCopy.account = activeChat.account;
    }
    setActiveChat(activeChatCopy as ActiveChat);
    activeChatRef.current = activeChatCopy as ActiveChat;
  };

  const [messagesOffset, setMessagesOffset] = useState(20);
  const [totalMessageCount, setTotalMessageCount] = useState(0);

  const loadPrevMessages = async (
    _id: string
  ): Promise<ChatMessagesDataWithOlder> => {
    if (messagesOffset >= totalMessageCount) {
      return {
        messages: [],
        totalCount: totalMessageCount,
        hasOlder: false,
      };
    }

    const messages: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: activeChatRef.current?.name || "" },
        limit: 20,
        offset: messagesOffset,
        is_dm: activeChat?.type === "direct_message",
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: ApiMessage) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
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
      setMessagesOffset(messagesOffset + 20);
      return {
        messages: messagesArray,
        totalCount: messages.data.total_count,
        hasOlder: messages.data.start_position < messages.data.total_count,
      };
    } else {
      return {
        messages: [],
        totalCount: 0,
        hasOlder: false,
      };
    }
  };

  const createDM = async (value: string) => {
    const response = await new ContextApiDataSource().createContext({
      user: value,
    });
    if (response.data) {
      const inviteResponse = await new ContextApiDataSource().inviteToContext({
        contextId: response.data.contextId,
        invitee: value,
        inviter: response.data.memberPublicKey,
      });
      if (inviteResponse.data) {
        const invitationPayload = inviteResponse.data;
        const createDmResponse = await new ClientApiDataSource().createDm({
          user: value,
          creator: response.data.memberPublicKey,
          timestamp: Date.now(),
          context_id: response.data.contextId,
          invitation_payload: invitationPayload,
        });
        if (createDmResponse.data) {
          await fetchDms();
        }
      }
    }
  };

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
      fetchChannels={fetchChannels}
      onJoinedChat={onJoinedChat}
      loadPrevMessages={loadPrevMessages}
      chatMembers={chatMembers}
      createDM={createDM}
      privateDMs={privateDMs}
    />
  );
}
