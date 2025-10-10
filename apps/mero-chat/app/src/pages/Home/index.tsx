import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
} from "react";
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
import useNotificationSound from "../../hooks/useNotificationSound";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export default function Home({ isConfigSet }: { isConfigSet: boolean }) {
  const { app } = useCalimero();
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [channelUsers, setChannelUsers] = useState<Map<string, string>>(
    new Map()
  );
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

  const { playSoundForMessage, playSound } = useNotificationSound(
    {
      enabled: false, // Start disabled - user needs to enable in settings
      volume: 0.5,
      respectFocus: true,
      respectMute: true,
    },
    activeChat?.id
  );

  // Initialize audio context on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      playSound('message'); // This will initialize the audio context
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [playSound]);

  const [currentSubscriptionContextId, setCurrentSubscriptionContextId] =
    useState<string>("");

  const manageEventSubscription = useCallback(
    (contextId: string) => {
      if (!app || !contextId) return;

      if (
        currentSubscriptionContextId &&
        currentSubscriptionContextId !== contextId
      ) {
        try {
          app.unsubscribeFromEvents([currentSubscriptionContextId]);
        } catch (error) {
          console.error(
            "Failed to unsubscribe from:",
            currentSubscriptionContextId,
            error
          );
        }
      }

      try {
        app.subscribeToEvents([contextId], eventCallback);
        setCurrentSubscriptionContextId(contextId);
      } catch (error) {
        console.error("Failed to subscribe to:", contextId, error);
      }
    },
    [app, currentSubscriptionContextId]
  );

  useEffect(() => {
    if (!isConfigSet) {
      window.location.href = "/login";
    }
  }, [isConfigSet]);

  useEffect(() => {
    currentOpenThreadRef.current = currentOpenThread;
  }, [currentOpenThread]);

  const getChannelUsers = async (channelId: string) => {
    const channelUsers: ResponseData<Map<string, string>> =
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

  const updateSelectedActiveChat = async (selectedChat: ActiveChat) => {
    // Find the channel metadata to get channelType
    const channelMeta = channels.find(ch => ch.name === selectedChat.name);
    if (channelMeta && selectedChat.type === "channel") {
      selectedChat.channelType = channelMeta.channelType;
    }
    
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    activeChatRef.current = selectedChat;
    getChannelUsers(selectedChat.id);
    getNonInvitedUsers(selectedChat.id);
    setIsSidebarOpen(false);
    updateSessionChat(selectedChat);
    if (app) {
      const useDM = (selectedChat.type === "direct_message" &&
        selectedChat.account &&
        !selectedChat.canJoin &&
        selectedChat.otherIdentityNew) as boolean;
      const contextId = getContextId();
      const dmContextId = getDmContextId();
      const currentContextId = (useDM ? dmContextId : contextId) || "";
      if (currentContextId) {
        manageEventSubscription(currentContextId);
      }
    }
    setMessagesOffset(20);
    setTotalMessageCount(0);
    setOpenThread(undefined);
    setCurrentOpenThread(undefined);
    if (selectedChat.type === "channel") {
      const messages = messagesRef.current;
      if (
        messages &&
        messages.length > 0 &&
        messages[messages.length - 1]?.timestamp
      ) {
        const lastMessageTimestamp = messages[messages.length - 1].timestamp;
        await new ClientApiDataSource().readMessage({
          channel: { name: selectedChat.name },
          timestamp: lastMessageTimestamp,
        });
      }
    }
  };

  const openSearchPage = useCallback(() => {
    setIsOpenSearchChannel(true);
    setIsSidebarOpen(false);
    setActiveChat(null);
  }, []);

  useLayoutEffect(() => {
    const storedSession: ActiveChat | null = getStoredSession();
    const chatToUse = storedSession || defaultActiveChat;

    setActiveChat(chatToUse);
    activeChatRef.current = chatToUse;
    getChannelUsers(chatToUse.name);
    getNonInvitedUsers(chatToUse.name);


    setTimeout(() => {
      updateSelectedActiveChat(chatToUse);
    }, 500);

    setMessagesOffset(20);
    setTotalMessageCount(0);
    updateSelectedActiveChat(chatToUse);
  }, [app, manageEventSubscription]);

  const onDMSelected = useCallback(
    async (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => {
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
          username: dm?.own_username || "",
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
          username: dm?.other_username || "",
          account: dm?.own_identity || "",
          otherIdentityNew: dm?.other_identity_new || "",
          creator: dm?.created_by || "",
          isSynced: isSynced,
        };
      }

      setDmContextId(sc?.contextId || dm?.context_id || "");
      setIsOpenSearchChannel(false);
      setActiveChat(selectedChat);
      activeChatRef.current = selectedChat;
      setIsSidebarOpen(false);
      setMessagesOffset(20);
      setTotalMessageCount(0);
      setOpenThread(undefined);
      setCurrentOpenThread(undefined);
      updateSelectedActiveChat(selectedChat);

      if (refetch) {
        try {
          await new ClientApiDataSource().readDm({
            other_user_id: dm?.other_identity_old || "",
          });
        } catch (error) {
          console.error("Error in onDMSelected:", error);
        }
      }
    },
    []
  );

  // Refs to prevent infinite loops and track processing state
  const isProcessingEvent = useRef(false);
  const lastEventTime = useRef(0);
  const eventQueue = useRef<Set<string>>(new Set());

  // Debounced function to prevent rapid-fire events
  const debouncedFetchChannels = useCallback(
    debounce(() => {
      fetchChannels();
    }, 300),
    []
  );

  const debouncedFetchDms = useCallback(
    debounce(() => {
      fetchDms();
    }, 300),
    []
  );

  // Self-contained function to handle message updates
  const handleMessageUpdates = useCallback(async (useDM: boolean) => {
    if (!activeChatRef.current) return;

    try {
      const reFetchedMessages: ResponseData<FullMessageResponse> =
        await new ClientApiDataSource().getMessages({
          group: {
            name: (useDM ? "private_dm" : activeChatRef.current?.name) || "",
          },
          limit: 20,
          offset: 0,
          is_dm: useDM,
          dm_identity: activeChatRef.current?.account,
        });

      if (!reFetchedMessages.data) return;

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
          senderUsername: message.sender_username,
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
        // Mark messages as read (but don't await to prevent blocking)
        if (activeChat?.type === "channel") {
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage?.timestamp) {
            new ClientApiDataSource().readMessage({
              channel: { name: activeChat?.name },
              timestamp: lastMessage.timestamp,
            }).catch(console.error);
          }
          playSoundForMessage(lastMessage.id, 'message', false);
        } else {
          new ClientApiDataSource().readDm({
            other_user_id: activeChatRef.current?.name || "",
          }).catch(console.error);
        }

        setIncomingMessages(newMessages);
        messagesRef.current = [...messagesRef.current, ...newMessages];
      }
    } catch (error) {
      console.error("Error handling message updates:", error);
    }
  }, [activeChat]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDMUpdates = useCallback(async (sessionChat: any) => {
    if (sessionChat?.type !== "direct_message") return;

    try {
      const updatedDMs = await fetchDms();
      
      if (
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
        onDMSelected(currentDM, undefined, false);
      }
    } catch (error) {
      console.error("Error handling DM updates:", error);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleStateMutation = useCallback(async (_event: any) => {
    const sessionChat = getStoredSession();
    const useDM = (sessionChat?.type === "direct_message" &&
      sessionChat?.account &&
      !sessionChat?.canJoin &&
      sessionChat?.otherIdentityNew) as boolean;

    // Update channels and DMs
    debouncedFetchChannels();
    debouncedFetchDms();

    // Handle DM-specific updates
    await handleDMUpdates(sessionChat);

    // Handle channel member updates for non-DM chats
    if (sessionChat?.type !== "direct_message") {
      await reFetchChannelMembers();
    }

    // Handle message updates
    await handleMessageUpdates(useDM);
  }, [debouncedFetchChannels, debouncedFetchDms, handleDMUpdates, handleMessageUpdates, reFetchChannelMembers]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleExecutionEvent = useCallback(async (event: any) => {
    
    if (!event.data?.events || event.data.events.length === 0) {
      return;
    }

    const executionEvents = event.data.events;
    
    for (const executionEvent of executionEvents) {
      switch (executionEvent.kind) {
        case "MessageSent":
          // On sender node do nothing as this will only duplicate the message
          break;
        case "ChannelCreated":
          debouncedFetchChannels();
          break;
      }
    }
  }, [debouncedFetchChannels]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventCallback = useCallback(async (event: any) => {
    // Prevent infinite loops
    if (isProcessingEvent.current) {
      return;
    }

    // Rate limiting - prevent events from firing too frequently
    const now = Date.now();
    if (now - lastEventTime.current < 100) {
      return;
    }
    lastEventTime.current = now;

    // Prevent duplicate events
    const eventId = `${event.type}-${event.data?.timestamp || now}`;
    if (eventQueue.current.has(eventId)) {
      return;
    }
    eventQueue.current.add(eventId);

    // Clean up old events from queue (keep only last 10)
    if (eventQueue.current.size > 10) {
      const eventsArray = Array.from(eventQueue.current);
      eventQueue.current = new Set(eventsArray.slice(-5));
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
      eventQueue.current.delete(eventId);
      return;
    }

    isProcessingEvent.current = true;

    try {
      switch (event.type) {
        case "StateMutation":
          await handleStateMutation(event);
          break;
        case "ExecutionEvent":
          await handleExecutionEvent(event);
          break;
        default:
      }
    } catch (callbackError) {
      console.error("Error in subscription callback:", callbackError);
    } finally {
      isProcessingEvent.current = false;
      eventQueue.current.delete(eventId);
    }
  }, [handleStateMutation, handleExecutionEvent]);

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
          senderUsername: message.sender_username,
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

      if (activeChat?.type === "channel") {
        const messages = messagesRef.current;
        if (
          messages &&
          messages.length > 0 &&
          messages[messages.length - 1]?.timestamp
        ) {
          const lastMessageTimestamp = messages[messages.length - 1].timestamp;
          await new ClientApiDataSource().readMessage({
            channel: { name: activeChat?.name },
            timestamp: lastMessageTimestamp,
          });
        }
      }
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
          createdByUsername: channelInfo.created_by_username,
          members: [],
          createdBy: channelInfo.created_by,
          inviteOnly: false,
          unreadMessages: {
            count: channelInfo.unread_count,
            mentions: channelInfo.unread_mention_count,
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
      dms.data.forEach((dm) => {
        if (dm.unread_messages > 0) {
          playSoundForMessage(`dm-${dm.other_identity_old}`, 'dm');
        }
      });
      setPrivateDMs(dms.data);
      return dms.data;
    }
  };

  const [chatMembers, setChatMembers] = useState<Map<string, string>>(
    new Map()
  );

  const fetchChatMembers = async () => {
    const chatMembers: ResponseData<Map<string, string>> =
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
        if (app) {
          const useDM = (activeChatRef.current?.type === "direct_message" &&
            activeChatRef.current?.account &&
            !activeChatRef.current?.canJoin &&
            activeChatRef.current?.otherIdentityNew) as boolean;
          const contextId = getContextId();
          const dmContextId = getDmContextId();
          const currentContextId = (useDM ? dmContextId : contextId) || "";
          if (currentContextId) {
            manageEventSubscription(currentContextId);
          }
        }
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
          senderUsername: message.sender_username,
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
    // @ts-expect-error - chatMembers is a Map<string, string>
    const creatorUsername = chatMembers[getExecutorPublicKey() || ""];
    // @ts-expect-error - chatMembers is a Map<string, string>
    const inviteeUsername = chatMembers[value];
    const dmParams = generateDMParams(value, creatorUsername, inviteeUsername);
    const response = await apiClient
      .node()
      .createContext(
        dmParams.applicationId,
        dmParams.params,
        dmParams.protocol
      );

    const verifyContextResponse = await apiClient
      .node()
      .getContext(response?.data?.contextId || "");
    const hash =
      verifyContextResponse.data?.rootHash ??
      "11111111111111111111111111111111";

    if (response.data) {
      const createDMResponse = await new ClientApiDataSource().createDm({
        context_id: response.data.contextId,
        creator: getExecutorPublicKey() || "",
        creator_new_identity: response.data.memberPublicKey,
        context_hash: hash as string,
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
          senderUsername: message.sender_username,
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
          senderUsername: message.sender_username,
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
