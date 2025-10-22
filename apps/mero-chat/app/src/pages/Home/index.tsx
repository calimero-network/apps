import {
  useCallback,
  useEffect,
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
import {
  SUBSCRIPTION_INIT_DELAY_MS,
} from "../../constants/app";
import { log } from "../../utils/logger";
import type { WebSocketEvent } from "../../types/WebSocketTypes";
import { useChannels } from "../../hooks/useChannels";
import { useDMs } from "../../hooks/useDMs";
import { useChatMembers } from "../../hooks/useChatMembers";
import { useChannelMembers } from "../../hooks/useChannelMembers";
import { useMessages } from "../../hooks/useMessages";
import { useThreadMessages } from "../../hooks/useThreadMessages";
import { useWebSocketSubscription } from "../../hooks/useWebSocketSubscription";
import { useChatHandlers } from "../../hooks/useChatHandlers";

export default function Home({ isConfigSet }: { isConfigSet: boolean }) {
  const { app } = useCalimero();
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [currentOpenThread, setCurrentOpenThread] = useState<
    CurbMessage | undefined
  >(undefined);
  const activeChatRef = useRef<ActiveChat | null>(null);
  const currentOpenThreadRef = useRef<CurbMessage | undefined>(undefined);
  const [openThread, setOpenThread] = useState<CurbMessage | undefined>(
    undefined
  );
  
  // Ref for subscription to avoid circular dependency
  const subscriptionRef = useRef<{ subscribe: (contextId: string) => void } | null>(null);

  // Use message hooks for cleaner message management
  const mainMessages = useMessages();
  const threadMessages = useThreadMessages();

  // Simplified - no complex callback stabilization needed
  const { playSoundForMessage, playSound } = useNotificationSound(
    {
      enabled: false,
      volume: 0.5,
      respectFocus: true,
      respectMute: true,
    },
    activeChat?.id
  );

  // Use custom hooks for data management - simplified, no props needed
  const channelsHook = useChannels();
  const dmsHook = useDMs();
  const chatMembersHook = useChatMembers();
  const channelMembersHook = useChannelMembers();
  
  // Expose for compatibility with existing code
  const messagesRef = mainMessages.messagesRef;
  const incomingMessages = mainMessages.incomingMessages;
  const addOptimisticMessage = mainMessages.addOptimistic;
  const addOptimisticThreadMessage = threadMessages.addOptimistic;

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


  useEffect(() => {
    if (!isConfigSet) {
      window.location.href = "/login";
    }
  }, [isConfigSet]);

  useEffect(() => {
    currentOpenThreadRef.current = currentOpenThread;
  }, [currentOpenThread]);

  // Use channel members hook - store in refs to prevent re-renders
  const getChannelUsersRef = useRef(channelMembersHook.fetchChannelMembers);
  const getNonInvitedUsersRef = useRef(channelMembersHook.fetchNonInvitedUsers);
  
  getChannelUsersRef.current = channelMembersHook.fetchChannelMembers;
  getNonInvitedUsersRef.current = channelMembersHook.fetchNonInvitedUsers;
  
  const getChannelUsers = useCallback(async (id: string) => {
    return getChannelUsersRef.current(id);
  }, []);
  
  const getNonInvitedUsers = useCallback(async (id: string) => {
    return getNonInvitedUsersRef.current(id);
  }, []);

  const reFetchChannelMembers = useCallback(async () => {
    const isDM = activeChatRef.current?.type === "direct_message";
    await getChannelUsersRef.current(
      (isDM ? "private_dm" : activeChatRef.current?.id) || ""
    );
  }, []);

  // Track last chat to prevent duplicate fetches
  const lastSelectedChatIdRef = useRef<string>("");
  
  const updateSelectedActiveChat = async (selectedChat: ActiveChat) => {
    // Find the channel metadata to get channelType
    const channelMeta = channels.find((ch: ChannelMeta) => ch.name === selectedChat.name);
    if (channelMeta && selectedChat.type === "channel") {
      selectedChat.channelType = channelMeta.channelType;
    }
    
    // Clear message state using hooks
    mainMessages.clear();
    threadMessages.clear();
    setOpenThread(undefined);
    setCurrentOpenThread(undefined);
    
    // Then update the active chat
    setIsOpenSearchChannel(false);
    setActiveChat(selectedChat);
    activeChatRef.current = selectedChat;
    setIsSidebarOpen(false);
    updateSessionChat(selectedChat);
    
    // Only fetch channel users/non-invited if this is a new chat
    // Prevents excessive API calls when re-selecting the same chat
    const chatId = selectedChat.id || selectedChat.name;
    if (lastSelectedChatIdRef.current !== chatId) {
      lastSelectedChatIdRef.current = chatId;
      
      // Only fetch for channels, not for DMs
      if (selectedChat.type === "channel") {
        getChannelUsers(selectedChat.id);
        getNonInvitedUsers(selectedChat.id);
      }
    }
    
    // Refresh channels list after a delay to show updated unread counts
    // Use longer delay to reduce API calls during rapid channel switching
    setTimeout(() => {
      channelsHook.fetchChannels();
    }, 1000);
    
    // Subscribe to websocket events for this chat
    if (app && subscriptionRef.current) {
      const useDM = (selectedChat.type === "direct_message" &&
        selectedChat.account &&
        !selectedChat.canJoin &&
        selectedChat.otherIdentityNew) as boolean;
      const contextId = getContextId();
      const dmContextId = getDmContextId();
      const currentContextId = (useDM ? dmContextId : contextId) || "";
      if (currentContextId) {
        subscriptionRef.current.subscribe(currentContextId);
      }
    }
  };

  const openSearchPage = useCallback(() => {
    setIsOpenSearchChannel(true);
    setIsSidebarOpen(false);
    setActiveChat(null);
  }, []);

  useEffect(() => {
    const storedSession: ActiveChat | null = getStoredSession();
    if (!storedSession) return;

    setActiveChat(storedSession);
    activeChatRef.current = storedSession;
    
    // Only fetch channel members for actual channels, not DMs
    if (storedSession.type === "channel") {
      getChannelUsers(storedSession.name);
      getNonInvitedUsers(storedSession.name);
    }
    
    mainMessages.clear();
    threadMessages.clear();

    // Delay to ensure app is ready before subscribing
    setTimeout(() => {
      updateSelectedActiveChat(storedSession);
    }, SUBSCRIPTION_INIT_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Track last DM selection to prevent rapid re-selections
  const lastDMSelectionRef = useRef<{ contextId: string; timestamp: number } | null>(null);
  
  // Simple debounce timers - no complex closures
  const channelsDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dmsDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const membersDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  // Store latest fetch functions in refs
  const fetchChannelsRef = useRef(channelsHook.fetchChannels);
  const fetchDmsRef = useRef(dmsHook.fetchDms);
  const fetchMembersRef = useRef(chatMembersHook.fetchMembers);
  
  // Update fetch refs every render (no useEffect needed)
  fetchChannelsRef.current = channelsHook.fetchChannels;
  fetchDmsRef.current = dmsHook.fetchDms;
  fetchMembersRef.current = chatMembersHook.fetchMembers;
  
  // Create stable debounced wrappers
  const debouncedFetchChannels = useCallback(async () => {
    clearTimeout(channelsDebounceRef.current);
    channelsDebounceRef.current = setTimeout(() => fetchChannelsRef.current(), 3000);
  }, []);
  
  const debouncedFetchDMs = useCallback(async () => {
    clearTimeout(dmsDebounceRef.current);
    dmsDebounceRef.current = setTimeout(() => fetchDmsRef.current(), 3000);
  }, []);
  
  const debouncedFetchMembers = useCallback(async () => {
    clearTimeout(membersDebounceRef.current);
    membersDebounceRef.current = setTimeout(() => fetchMembersRef.current(), 3000);
  }, []);

  // Create refs for handlers
  const mainMessagesRef = useRef(mainMessages);
  const threadMessagesRef = useRef(threadMessages);
  const playSoundForMessageRef = useRef(playSoundForMessage);
  const onDMSelectedRef = useRef<(dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void>(() => {});
  
  // Update refs every render (no useEffect to avoid triggering extra renders)
  mainMessagesRef.current = mainMessages;
  threadMessagesRef.current = threadMessages;
  playSoundForMessageRef.current = playSoundForMessage;
  
  const chatHandlersRefs = useRef({
    mainMessages: mainMessagesRef,
    threadMessages: threadMessagesRef,
    playSoundForMessage: playSoundForMessageRef,
    fetchDms: fetchDmsRef,
    onDMSelected: onDMSelectedRef,
    fetchChannels: { current: debouncedFetchChannels },
    fetchDMs: { current: debouncedFetchDMs },
    fetchMembers: { current: debouncedFetchMembers },
  }).current;
  
  // Store updateSelectedActiveChat in ref to avoid dependency
  const updateSelectedActiveChatRef = useRef(updateSelectedActiveChat);
  updateSelectedActiveChatRef.current = updateSelectedActiveChat;
  
  
  const onDMSelected = useCallback(
    async (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => {
      const contextId = sc?.contextId || dm?.context_id || "";
      
      // Prevent rapid re-selection of the same DM (within 1 second)
      const now = Date.now();
      if (
        lastDMSelectionRef.current &&
        lastDMSelectionRef.current.contextId === contextId &&
        now - lastDMSelectionRef.current.timestamp < 1000
      ) {
        log.debug("onDMSelected", "Skipping rapid re-selection of same DM");
        return;
      }
      
      lastDMSelectionRef.current = { contextId, timestamp: now };
      
      let canJoin = true;
      const verifyContextResponse = await apiClient
        .node()
        .getContext(contextId);
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
      mainMessagesRef.current.clear();
      threadMessagesRef.current.clear();
      
      await updateSelectedActiveChatRef.current(selectedChat);

      if (refetch) {
        try {
          await new ClientApiDataSource().readDm({
            other_user_id: dm?.other_identity_old || "",
          });
          await fetchDmsRef.current();
        } catch (error) {
          log.error("onDMSelected", "Error in DM selection", error);
        }
      }
    },
    [] // NO DEPENDENCIES - everything through refs
  );
  
  // Update onDMSelected ref (no useEffect - direct assignment)
  onDMSelectedRef.current = onDMSelected;

  const loadInitialChatMessages = useCallback(async (): Promise<ChatMessagesData> => {
    const result = await mainMessagesRef.current.loadInitial(activeChatRef.current);

    if (activeChatRef.current?.type === "channel" && result.messages.length > 0) {
      const lastMessage = result.messages[result.messages.length - 1];
      if (lastMessage?.timestamp) {
        await new ClientApiDataSource().readMessage({
          channel: { name: activeChatRef.current.name },
          timestamp: lastMessage.timestamp,
        });
      }
    }

    return result;
  }, []); // NO DEPENDENCIES - everything through refs

  // Use custom hooks instead of local state + fetch functions
  const channels = channelsHook.channels;
  const fetchChannels = channelsHook.fetchChannels;
  
  const privateDMs = dmsHook.dms;
  const fetchDms = dmsHook.fetchDms;
  
  const chatMembers = chatMembersHook.members;
  const fetchChatMembers = chatMembersHook.fetchMembers;

  // Use chat handlers hook - simplified with refs
  const {
    handleMessageUpdates,
    handleThreadMessageUpdates,
    handleDMUpdates,
    handleStateMutation,
    handleExecutionEvents,
  } = useChatHandlers(
    activeChatRef,
    activeChat,
    chatHandlersRefs
  );

  // Track event processing to prevent overlap
  const isProcessingEventRef = useRef(false);
  const eventBatchRef = useRef<WebSocketEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Process batched events efficiently
   * Since we only get StateMutation events, batch them and only process the latest
   */
  const processBatchedEvents = useCallback(async () => {
    if (isProcessingEventRef.current || eventBatchRef.current.length === 0) {
      return;
    }

    isProcessingEventRef.current = true;
    const events = [...eventBatchRef.current];
    eventBatchRef.current = [];

    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }

    try {
      // Since all events are StateMutations, only process the latest one
      // (it will fetch all new messages anyway)
      const latestEvent = events[events.length - 1];
      
      if (import.meta.env.DEV && events.length > 1) {
        log.debug('WebSocket', `Batched ${events.length} StateMutations, processing only the latest`);
      }

      await handleStateMutation(latestEvent);
      
      // Also handle thread messages if a thread is open
      if (openThread) {
        const sessionChat = getStoredSession();
        const useDM = (sessionChat?.type === "direct_message" &&
          sessionChat?.account &&
          !sessionChat?.canJoin &&
          sessionChat?.otherIdentityNew) as boolean;
        
        await handleThreadMessageUpdates(useDM, openThread.id);
      }
    } catch (error) {
      log.error('WebSocket', 'Error processing batched events', error);
    } finally {
      isProcessingEventRef.current = false;
    }
  }, [handleStateMutation, handleThreadMessageUpdates, openThread]);

  // Create event callback for websocket subscription
  const eventCallbackFn = useCallback(async (event: WebSocketEvent) => {
    // Validate context before processing
    const sessionChat = getStoredSession();
    const useDM = (sessionChat?.type === "direct_message" &&
      sessionChat?.account &&
      !sessionChat?.canJoin &&
      sessionChat?.otherIdentityNew) as boolean;

    const contextId = getContextId();
    const dmContextId = getDmContextId();
    const currentContextId = (useDM ? dmContextId : contextId) || "";

    if (!currentContextId) {
      return; // Skip if no valid context
    }

    // Add event to batch
    eventBatchRef.current.push(event);

    // Clear existing timer
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
    }

    // Check if we should process immediately or wait for more events
    const shouldProcessNow = eventBatchRef.current.length >= 20; // Increase to 20 to batch more

    if (shouldProcessNow) {
      processBatchedEvents();
    } else {
      // Increase timer to 300ms to batch more events together and reduce processing frequency
      batchTimerRef.current = setTimeout(() => {
        processBatchedEvents();
      }, 300);
    }
  }, [processBatchedEvents]);

  // Use WebSocket subscription hook (pass callback directly, hook handles refs internally)
  const subscription = useWebSocketSubscription(app, eventCallbackFn);
  
  // Store subscription in ref for updateSelectedActiveChat
  subscriptionRef.current = subscription;

  // Track if initial fetch has been done - using useState to ensure it persists
  const initialFetchDone = useRef(false);
  const isFetchingInitial = useRef(false);

  useEffect(() => {
    // Only fetch once on mount to avoid 429 errors from rapid refetches
    // Use both flags to prevent concurrent fetches
    if (!initialFetchDone.current && !isFetchingInitial.current) {
      isFetchingInitial.current = true;
      
      // Batch initial data fetches for faster load using custom hooks
      Promise.all([
        channelsHook.fetchChannels(),
        dmsHook.fetchDms(),
        chatMembersHook.fetchMembers(),
      ]).then(() => {
        initialFetchDone.current = true;
        isFetchingInitial.current = false;
      }).catch(error => {
        log.error("Home", "Error fetching initial data", error);
        isFetchingInitial.current = false;
      });
    }

    // Cleanup is handled by useWebSocketSubscription hook
  }, [channelsHook, dmsHook, chatMembersHook]);

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
            subscription.subscribe(currentContextId);
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

  const loadPrevMessages = useCallback(
    async (chatId: string): Promise<ChatMessagesDataWithOlder> => {
      return await mainMessagesRef.current.loadPrevious(activeChatRef.current, chatId);
    },
    [] // NO DEPENDENCIES
  );

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

  const loadInitialThreadMessages = useCallback(
    async (parentMessageId: string): Promise<ChatMessagesData> => {
      log.debug('Home', `loadInitialThreadMessages called for parent: ${parentMessageId}`);
      const result = await threadMessagesRef.current.loadInitial(activeChatRef.current, parentMessageId);
      log.debug('Home', `loadInitialThreadMessages result:`, result);
      return result;
    },
    [] // NO DEPENDENCIES
  );

  const updateCurrentOpenThread = useCallback(
    (thread: CurbMessage | undefined) => {
      setCurrentOpenThread(thread);
    },
    []
  );

  const loadPrevThreadMessages = useCallback(
    async (parentMessageId: string): Promise<ChatMessagesDataWithOlder> => {
      return await threadMessagesRef.current.loadPrevious(activeChatRef.current, parentMessageId);
    },
    [] // NO DEPENDENCIES
  );

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
      channelUsers={channelMembersHook.channelUsers}
      nonInvitedUserList={channelMembersHook.nonInvitedUsers}
      onDMSelected={onDMSelected}
      loadInitialChatMessages={loadInitialChatMessages}
      incomingMessages={mainMessages.incomingMessages}
      channels={channels}
      fetchChannels={fetchChannels}
      onJoinedChat={onJoinedChat}
      loadPrevMessages={loadPrevMessages}
      chatMembers={chatMembers}
      createDM={createDM}
      privateDMs={privateDMs}
      loadInitialThreadMessages={loadInitialThreadMessages}
      incomingThreadMessages={threadMessages.incomingMessages}
      loadPrevThreadMessages={loadPrevThreadMessages}
      updateCurrentOpenThread={updateCurrentOpenThread}
      openThread={openThread}
      setOpenThread={setOpenThread}
      currentOpenThreadRef={currentOpenThreadRef}
      addOptimisticMessage={addOptimisticMessage}
      addOptimisticThreadMessage={addOptimisticThreadMessage}
    />
  );
}
