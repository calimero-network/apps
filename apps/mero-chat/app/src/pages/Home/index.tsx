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
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import {
  type ResponseData,
  apiClient,
  getContextId,
  getExecutorPublicKey,
  useCalimero,
} from "@calimero-network/calimero-client";
import {
  type Channels,
  type DMChatInfo,
  type FullMessageResponse,
  type UserId,
} from "../../api/clientApi";
import type { MessageWithReactions } from "../../api/clientApi";
import type { CreateContextResult } from "../../components/popups/StartDMPopup";
import { generateDMParams } from "../../utils/dmSetupState";

export default function Home({ isConfigSet }: { isConfigSet: boolean }) {
  const { app } = useCalimero();
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<UserId[]>([]);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [nonInvitedUserList, setNonInvitedUserList] = useState<UserId[]>([]);
  const [totalThreadMessageCount, setTotalThreadMessageCount] = useState(0);
  const [threadMessagesOffset, setThreadMessagesOffset] = useState(20);
  const [incomingThreadMessages, _setIncomingThreadMessages] = useState<
    CurbMessage[]
  >([]);
  const [currentOpenThread, setCurrentOpenThread] = useState<
    CurbMessage | undefined
  >(undefined);
  const messagesRef = useRef<CurbMessage[]>([]);
  const messagesThreadRef = useRef<CurbMessage[]>([]);
  const activeChatRef = useRef<ActiveChat | null>(null);
  const currentOpenThreadRef = useRef<CurbMessage | undefined>(undefined);
  const [openThread, setOpenThread] = useState<CurbMessage | undefined>(
    undefined
  );

  useEffect(() => {
    if (!isConfigSet) {
      window.location.href = "/login";
    }
  }, [isConfigSet]);

  // Sync the ref with the state
  useEffect(() => {
    currentOpenThreadRef.current = currentOpenThread;
  }, [currentOpenThread]);

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
    const isDM = activeChatRef.current?.type === "direct_message";
    await getChannelUsers(
      (isDM ? "private_dm" : activeChatRef.current?.id) || ""
    );
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
    setOpenThread(undefined);
    setCurrentOpenThread(undefined);
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

  const onDMSelected = useCallback(async (dm?: DMChatInfo, sc?: ActiveChat) => {
    let canJoin = true;
    const verifyContextResponse = await apiClient
      .node()
      .getContext((sc?.contextId ? sc.contextId : dm?.context_id) || "");
    if (verifyContextResponse.data) {
      canJoin = !(verifyContextResponse.data.rootHash ? true : false);
    }

    const isSynced =
      verifyContextResponse.data?.rootHash !==
      "11111111111111111111111111111111";

    if ((sc?.account || dm?.own_identity) && !canJoin && isSynced) {
      await new ClientApiDataSource().joinChat({
        contextId: dm?.context_id || "",
        isDM: true,
        executor: dm?.own_identity || "",
      });
    }

    let selectedChat = {} as ActiveChat;
    if (sc?.contextId) {
      selectedChat = {
        ...sc,
        canJoin: canJoin,
        isSynced: isSynced,
      };
    } else {
      selectedChat = {
        type: "direct_message" as ChatType,
        contextId: dm?.context_id || "",
        readOnly: false,
        canJoin: canJoin,
        invitationPayload: dm?.invitation_payload || "",
        id: dm?.other_identity_old || "",
        name: dm?.other_identity_old || "",
        account: dm?.own_identity || "",
        otherIdentityNew: dm?.other_identity_new || "",
        creator: dm?.created_by || "",
        isSynced: isSynced,
      };
    }

    updateSelectedActiveChat(selectedChat);
    setDmContextId(sc?.contextId || dm?.context_id || "");
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    activeChatRef.current = selectedChat;
    setIsSidebarOpen(false);
    setMessagesOffset(20);
    setTotalMessageCount(0);
    setOpenThread(undefined);
    setCurrentOpenThread(undefined);
  }, []);

  useEffect(() => {
    if (!app) {
      return;
    }

    if (!app.subscribeToEvents || !app.unsubscribeFromEvents) {
      return;
    }

    const sessionChat = getStoredSession();
    const useDM = (sessionChat?.type === "direct_message" &&
      sessionChat?.account &&
      !sessionChat?.canJoin &&
      sessionChat?.otherIdentityNew) as boolean;

    const contextId = getContextId();
    const dmContextId = getDmContextId();
    const currentContextId = (useDM ? dmContextId : contextId) || "";

    if (!currentContextId) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventCallback = async (event: any) => {
      try {
        if (event.type === "StateMutation") {
          fetchChannels();

          const updatedDMs = await fetchDms();

          if (
            sessionChat?.type === "direct_message" &&
            !sessionChat?.isFinal &&
            updatedDMs?.length &&
            (sessionChat?.canJoin ||
              !sessionChat?.isSynced ||
              !sessionChat?.account ||
              !sessionChat?.otherIdentityNew)
          ) {
            const currentDM = updatedDMs.find(
              (dm) => dm.context_id === sessionChat.contextId
            );
            onDMSelected(currentDM);
          }

          if (sessionChat?.type !== "direct_message") {
            await reFetchChannelMembers();
          }

          const reFetchedMessages: ResponseData<FullMessageResponse> =
            await new ClientApiDataSource().getMessages({
              group: {
                name:
                  (useDM ? "private_dm" : activeChatRef.current?.name) || "",
              },
              limit: 20,
              offset: 0,
              is_dm: useDM,
              dm_identity: activeChatRef.current?.account,
            });
          if (reFetchedMessages.data) {
            const existingMessageIds = new Set(
              messagesRef.current.map((msg) => msg.id)
            );
            const newMessages = reFetchedMessages.data.messages
              .filter(
                (message: MessageWithReactions) =>
                  !existingMessageIds.has(message.id)
              )
              .map((message: MessageWithReactions) => ({
                id: message.id,
                text: message.text,
                nonce: Math.random().toString(36).substring(2, 15),
                key: message.id,
                timestamp: message.timestamp * 1000,
                sender: message.sender,
                reactions: message.reactions,
                threadCount: message.thread_count,
                threadLastTimestamp: message.thread_last_timestamp,
                editedOn: undefined,
                mentions: [],
                files: [],
                images: [],
                editMode: false,
                status: MessageStatus.sent,
                deleted: message.deleted,
              }));

            if (newMessages.length > 0) {
              setIncomingMessages(newMessages);
              messagesRef.current = [...messagesRef.current, ...newMessages];
            }
          }
        } else if (event.type === "ExecutionEvent" && event.data?.events) {
          const executionEvents = event.data.events;
          for (const executionEvent of executionEvents) {
            if (executionEvent.kind === "MessageSent") {
              // On sender node do nothing as this will only duplicate the message
            } else if (executionEvent.kind === "ChannelCreated") {
              await fetchChannels();
            }
          }
        }
      } catch (callbackError) {
        console.error("Error in subscription callback:", callbackError);
      }
    };

    try {
      app.subscribeToEvents([currentContextId], eventCallback);
    } catch (error) {
      console.warn("Failed to subscribe to context events:", error);
    }

    return () => {
      try {
        app.unsubscribeFromEvents([currentContextId]);
      } catch (error) {
        console.warn("Error during event unsubscription:", error);
      }
    };
  }, [app]);

  const loadInitialChatMessages = async (): Promise<ChatMessagesData> => {
    if (!activeChat?.name) {
      return {
        messages: [],
        totalCount: 0,
        hasMore: false,
      };
    }
    const isDM = activeChat?.type === "direct_message";
    const messages: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: (isDM ? "private_dm" : activeChat?.name) || "" },
        limit: 20,
        offset: 0,
        is_dm: isDM,
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: MessageWithReactions) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
          timestamp: message.timestamp * 1000,
          sender: message.sender,
          reactions: message.reactions,
          threadCount: message.thread_count,
          threadLastTimestamp: message.thread_last_timestamp,
          editedOn: undefined,
          mentions: [],
          files: [],
          images: [],
          editMode: false,
          status: MessageStatus.sent,
          deleted: message.deleted,
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
      return dms.data;
    }
  };

  const [chatMembers, setChatMembers] = useState<UserId[]>([]);

  const fetchChatMembers = async () => {
    const chatMembers: ResponseData<UserId[]> =
      await new ClientApiDataSource().getChatMembers({
        isDM: false,
      });
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
      const joinContextResponse = await apiClient
        .node()
        .joinContext(activeChatRef.current?.invitationPayload || "");
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

    const isDM = activeChat?.type === "direct_message";
    const messages: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: {
          name: (isDM ? "private_dm" : activeChatRef.current?.name) || "",
        },
        limit: 20,
        offset: messagesOffset,
        is_dm: isDM,
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: MessageWithReactions) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
          timestamp: message.timestamp * 1000,
          sender: message.sender,
          reactions: message.reactions,
          threadCount: message.thread_count,
          threadLastTimestamp: message.thread_last_timestamp,
          editedOn: message.edited_on,
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

  const createDM = async (value: string): Promise<CreateContextResult> => {
    const dmParams = generateDMParams(value);
    const response = await apiClient
      .node()
      .createContext(
        dmParams.applicationId,
        dmParams.params,
        dmParams.protocol
      );

    if (response.data) {
      const createDMResponse = await new ClientApiDataSource().createDm({
        context_id: response.data.contextId,
        creator: getExecutorPublicKey() || "",
        creator_new_identity: response.data.memberPublicKey,
        invitee: value,
        timestamp: Date.now(),
      });
      if (createDMResponse.data) {
        await fetchDms();
        return {
          data: "DM created successfully",
          error: "",
        };
      } else {
        await apiClient.node().deleteContext(response.data.contextId);
        return {
          data: "",
          error: "Failed to create DM - DM already exists",
        };
      }
    } else {
      return {
        data: "",
        error: "Failed to create DM",
      };
    }
  };

  const loadInitialThreadMessages = async (
    parentMessageId: string
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
        limit: 20,
        offset: 0,
        parent_message: parentMessageId,
        is_dm: activeChat?.type === "direct_message",
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: MessageWithReactions) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
          timestamp: message.timestamp * 1000,
          sender: message.sender,
          reactions: message.reactions,
          threadCount: message.thread_count,
          threadLastTimestamp: message.thread_last_timestamp,
          editedOn: message.edited_on,
          mentions: [],
          files: [],
          images: [],
          editMode: false,
          status: MessageStatus.sent,
          deleted: message.deleted,
        })
      );

      messagesThreadRef.current = messagesArray;
      setTotalThreadMessageCount(messages.data.total_count);
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

  const updateCurrentOpenThread = useCallback(
    (thread: CurbMessage | undefined) => {
      setCurrentOpenThread(thread);
    },
    []
  );

  const loadPrevThreadMessages = async (
    parentMessageId: string
  ): Promise<ChatMessagesDataWithOlder> => {
    if (threadMessagesOffset >= totalThreadMessageCount) {
      return {
        messages: [],
        totalCount: totalThreadMessageCount,
        hasOlder: false,
      };
    }

    const messages: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: activeChatRef.current?.name || "" },
        limit: 20,
        offset: threadMessagesOffset,
        parent_message: parentMessageId,
        is_dm: activeChat?.type === "direct_message",
        dm_identity: activeChat?.account,
      });
    if (messages.data) {
      const messagesArray = messages.data.messages.map(
        (message: MessageWithReactions) => ({
          id: message.id,
          text: message.text,
          nonce: Math.random().toString(36).substring(2, 15),
          key: message.id,
          timestamp: message.timestamp * 1000,
          sender: message.sender,
          reactions: message.reactions,
          threadCount: message.thread_count,
          threadLastTimestamp: message.thread_last_timestamp,
          editedOn: message.edited_on,
          mentions: [],
          files: [],
          images: [],
          editMode: false,
          status: MessageStatus.sent,
          deleted: message.deleted,
        })
      );
      setThreadMessagesOffset(threadMessagesOffset + 20);
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
      loadInitialThreadMessages={loadInitialThreadMessages}
      incomingThreadMessages={incomingThreadMessages}
      loadPrevThreadMessages={loadPrevThreadMessages}
      updateCurrentOpenThread={updateCurrentOpenThread}
      openThread={openThread}
      setOpenThread={setOpenThread}
      currentOpenThreadRef={currentOpenThreadRef}
    />
  );
}
