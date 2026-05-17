import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppContainer from "../../components/common/AppContainer";
import { clearNamespaceReady } from "../../utils/session";
import {
  type ActiveChat,
  type ChatMessagesData,
  type ChatMessagesDataWithOlder,
  type CurbMessage,
} from "../../types/Common";
import {
  getStoredSession,
  updateSessionChat,
} from "../../utils/session";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import {
  setContextId,
  setContextIdentity as setExecutorPublicKey,
  useMero as useCalimero,
} from "@calimero-network/mero-react";
import type { CreateContextResult } from "../../components/popups/StartDMPopup";
import type { DMContextInfo } from "../../hooks/useDMs";
import { useAppNotifications } from "../../hooks/useAppNotifications";
import { SUBSCRIPTION_INIT_DELAY_MS } from "../../constants/app";
import { log } from "../../utils/logger";
import type { WebSocketEvent } from "../../types/WebSocketTypes";
import { useGroupContexts } from "../../hooks/useGroupContexts";
import { useDMs } from "../../hooks/useDMs";
import { useChatMembers } from "../../hooks/useChatMembers";
import { useChannelMembers } from "../../hooks/useChannelMembers";
import { useGroupMembers } from "../../hooks/useGroupMembers";
import { useMessages } from "../../hooks/useMessages";
import { useThreadMessages } from "../../hooks/useThreadMessages";
import { useWebSocket, useWebSocketEvents } from "../../contexts/WebSocketContext";
import { useChatHandlers } from "../../hooks/useChatHandlers";
import {
  getApplicationId,
  getGroupId,
  getGroupMemberIdentity,
  setGroupMemberIdentity,
  setContextMemberIdentity,
} from "../../constants/config";
import { getAppEntryState } from "../../utils/appEntry";
import { getMessengerDisplayName, getIdentityDisplayName, getStoredExecutorIdentity } from "../../utils/messengerName";
import {
  createDmContextInGroup,
  getDmDisplayName,
} from "../../utils/dmContext";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { useNamespaceMembershipWatch } from "../../hooks/useNamespaceMembershipWatch";
import { buildDmMemberOptions } from "../../utils/dmMemberOptions";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";

export default function Home({ isConfigSet }: { isConfigSet: boolean }) {
  const { mero: app } = useCalimero();
  const navigate = useNavigate();
  const currentGroupId = getGroupId();

  // Hard guard: if no namespace/group is actually selected, bounce back to
  // /login so the NamespaceEntryPopup picks one. Belt-and-braces with the
  // isNamespaceReady() check in App.tsx — that's a sessionStorage flag and
  // can fall out of sync with the real group selection.
  useEffect(() => {
    if (!currentGroupId) {
      clearNamespaceReady();
      navigate("/login", { replace: true });
    }
  }, [currentGroupId, navigate]);

  // Poll for admin-initiated removal: if the server has cascaded us out of
  // the namespace, redirect to /login. Without this, the user's stale
  // sidebar keeps showing channels they're no longer a member of (since
  // there's no SSE channel for governance ops yet).
  useNamespaceMembershipWatch();
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [currentOpenThread, setCurrentOpenThread] = useState<
    CurbMessage | undefined
  >(undefined);
  const activeChatRef = useRef<ActiveChat | null>(null);
  const currentOpenThreadRef = useRef<CurbMessage | undefined>(undefined);
  const [openThread, setOpenThread] = useState<CurbMessage | undefined>(
    undefined,
  );

  const webSocket = useWebSocket();

  const mainMessages = useMessages();
  const threadMessages = useThreadMessages();
  const {
    searchResults,
    searchTotalCount,
    searchQuery,
    isSearching: isSearchingMessages,
    searchOffset,
    searchMessages: executeSearchMessages,
    clearSearch: clearMessageSearch,
    searchError,
  } = mainMessages;
  const searchHasMore = searchOffset < searchTotalCount;

  const {
    notifyMessage,
    notifyDM,
    notifyChannel,
    notifyThread,
    playSoundForMessage,
    playSound,
  } = useAppNotifications(activeChat?.id);

  // Group-based channel list (replaces old useChannels)
  const groupContextsHook = useGroupContexts();
  const dmsHook = useDMs();
  const chatMembersHook = useChatMembers();
  const channelMembersHook = useChannelMembers();
  const groupMembersHook = useGroupMembers();
  const currentGroupPermissions = useCurrentGroupPermissions(currentGroupId);
  const { counts: unreadCounts, loadAll: loadAllUnread, refreshOne: refreshUnread, clearOne: clearUnread } = useUnreadCounts();

  const addOptimisticMessage = mainMessages.addOptimistic;
  const addOptimisticThreadMessage = threadMessages.addOptimistic;

  useEffect(() => {
    const handleFirstInteraction = () => {
      playSound("message");
      document.removeEventListener("click", handleFirstInteraction);
      document.removeEventListener("keydown", handleFirstInteraction);
    };

    document.addEventListener("click", handleFirstInteraction);
    document.addEventListener("keydown", handleFirstInteraction);

    return () => {
      document.removeEventListener("click", handleFirstInteraction);
      document.removeEventListener("keydown", handleFirstInteraction);
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

  const entryState = getAppEntryState({
    isAuthenticated: true,
    isConfigSet,
    groupId: currentGroupId,
    messengerName: getIdentityDisplayName(getStoredExecutorIdentity()) || getMessengerDisplayName(),
    activeChat,
  });

  useEffect(() => {
    if (entryState === "browse-channels") {
      setIsOpenSearchChannel(true);
      return;
    }

    if (entryState === "chat") {
      setIsOpenSearchChannel(false);
    }
  }, [entryState]);

  const getChannelUsersRef = useRef(channelMembersHook.fetchChannelMembers);
  getChannelUsersRef.current = channelMembersHook.fetchChannelMembers;

  const getChannelUsers = useCallback(async (id: string, subgroupId?: string, namespaceId?: string) => {
    return getChannelUsersRef.current(id, subgroupId, namespaceId);
  }, []);

  // Pin the channel→subgroup resolver in a ref so re-renders don't
  // recreate `reFetchChannelMembers` on every tick. Depending on the whole
  // `groupContextsHook` object (which is fresh each render) made this
  // callback unstable, which spiraled into a render loop in any popup
  // whose useEffect listed `reFetchChannelMembers` in its deps
  // (ChannelDetailsPopup, where the loop fires fetchAll →
  // listSubgroups/getGroup/getUpgradeStatus, exhausting browser sockets
  // with ERR_INSUFFICIENT_RESOURCES).
  const getSubgroupForContextRef = useRef(groupContextsHook.getSubgroupForContext);
  getSubgroupForContextRef.current = groupContextsHook.getSubgroupForContext;

  const reFetchChannelMembers = useCallback(async () => {
    const isDM = activeChatRef.current?.type === "direct_message";
    const channelId = (isDM ? "private_dm" : activeChatRef.current?.id) || "";
    // Pass the channel's subgroupId so `useChannelMembers` can read the
    // canonical member list from the admin API. Without this it falls
    // back to `get_profiles` which misses members who haven't set a
    // profile yet (the typical state for freshly-added users). The
    // namespaceId provides a final alias fallback so users render with
    // their workspace handle (e.g. "NodeUser") instead of their raw
    // identity until they post their first message in the channel.
    const contextId = activeChatRef.current?.contextId ?? activeChatRef.current?.id;
    const subgroupId = contextId
      ? getSubgroupForContextRef.current(contextId)
      : undefined;
    const namespaceId = getGroupId() || undefined;
    await getChannelUsersRef.current(channelId, subgroupId, namespaceId);
  }, []);

  const lastSelectedChatIdRef = useRef<string>("");

  /**
   * Switch the active chat. For channels (group contexts), this also switches
   * the calimero-client contextId and executorPublicKey so that subsequent
   * RPC calls (messages, reactions, etc.) target the correct context.
   */
  const updateSelectedActiveChat = async (selectedChat: ActiveChat) => {
    mainMessages.clear();
    threadMessages.clear();
    setOpenThread(undefined);
    setCurrentOpenThread(undefined);

    // For group-based channels and DMs, switch context identity
    let resolvedChat = selectedChat;

    if (
      (selectedChat.type === "channel" || selectedChat.type === "direct_message") &&
      selectedChat.contextId
    ) {
      const identity =
        selectedChat.contextIdentity ||
        groupContextsHook.getIdentity(selectedChat.contextId);

      if (identity) {
        resolvedChat = {
          ...selectedChat,
          contextIdentity: identity,
          canJoin: false,
          requiresProfileSetup: false,
        };
        setContextId(selectedChat.contextId);
        setExecutorPublicKey(identity);
        log.info(
          "Home",
          `Switched context to ${selectedChat.contextId.substring(0, 8)}... with identity ${identity.substring(0, 8)}...`,
        );
      } else {
        log.warn(
          "Home",
          `No identity found for context ${selectedChat.contextId} — RPC calls may fail`,
        );
        setContextId(selectedChat.contextId);
      }
    }

    // Commit the chat switch immediately — no blocking awaits
    setActiveChat(resolvedChat);
    activeChatRef.current = resolvedChat;
    setIsSidebarOpen(false);
    updateSessionChat(resolvedChat);

    // Clear unread badge and persist read position to WASM
    if (resolvedChat.contextId && resolvedChat.contextIdentity) {
      void clearUnread(resolvedChat.contextId, resolvedChat.contextIdentity);
    }

    // Bootstrap WASM admin role for namespace admins. set_member_role allows
    // a self-promotion to Admin when no admin exists in the WASM roles map yet.
    // After the first call this is a no-op (Admin → Admin is idempotent).
    if (
      currentGroupPermissions.isAdmin &&
      resolvedChat.contextId &&
      resolvedChat.contextIdentity
    ) {
      new ClientApiDataSource()
        .setMemberRole({
          contextId: resolvedChat.contextId,
          executorPublicKey: resolvedChat.contextIdentity,
          target: resolvedChat.contextIdentity,
          role: "Admin",
        })
        .catch(() => {});
    }

    const chatId = resolvedChat.id || resolvedChat.name;
    if (lastSelectedChatIdRef.current !== chatId) {
      lastSelectedChatIdRef.current = chatId;

      if (resolvedChat.type === "channel" && resolvedChat.contextIdentity) {
        const subgroupId = resolvedChat.contextId
          ? getSubgroupForContextRef.current(resolvedChat.contextId)
          : undefined;
        const namespaceId = getGroupId() || undefined;
        getChannelUsers(resolvedChat.id, subgroupId, namespaceId);
      }
    }

    log.debug(
      "Home",
      `Active chat changed to: ${resolvedChat.name} (context: ${resolvedChat.contextId || "n/a"})`,
    );
  };

  const openSearchPage = useCallback(() => {
    setIsOpenSearchChannel(true);
    setIsSidebarOpen(false);
    setActiveChat(null);
  }, []);

  const handleSearchMessages = useCallback(
    async (query: string) => {
      await executeSearchMessages(activeChatRef.current, query, { reset: true });
    },
    [executeSearchMessages],
  );

  const handleLoadMoreSearch = useCallback(async () => {
    if (!searchQuery) return;
    await executeSearchMessages(activeChatRef.current, searchQuery, {
      offset: searchOffset,
    });
  }, [executeSearchMessages, searchOffset, searchQuery]);

  const handleClearSearch = useCallback(() => {
    clearMessageSearch();
  }, [clearMessageSearch]);

  useEffect(() => {
    const storedSession: ActiveChat | null = getStoredSession();
    if (!storedSession) {
      return;
    }

    mainMessages.clear();
    threadMessages.clear();

    // Subscribe immediately to the stored context so SSE events arrive before
    // fetchGroupContexts completes (which drives the bulk subscription)
    if (storedSession.contextId) {
      webSocket.subscribeToContext(storedSession.contextId);
    }

    const timer = setTimeout(() => {
      void updateSelectedActiveChat(storedSession);
    }, SUBSCRIPTION_INIT_DELAY_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastDMSelectionRef = useRef<{
    contextId: string;
    timestamp: number;
  } | null>(null);

  // Stable ref for fetchDms that includes groupId
  const fetchDmsWithGroup = useCallback(() => {
    const gid = getGroupId();
    if (gid) return dmsHook.fetchDms(gid);
    return Promise.resolve([]);
  }, [dmsHook]);

  const channelsDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const dmsDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const membersDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const groupMembersDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const fetchGroupChannels = useCallback(() => {
    const gid = getGroupId();
    if (gid) groupContextsHook.fetchGroupContexts(gid);
  }, [groupContextsHook]);

  const fetchChannelsRef = useRef(fetchGroupChannels);
  const fetchDmsRef = useRef(fetchDmsWithGroup);
  const fetchMembersRef = useRef(chatMembersHook.fetchMembers);
  const fetchGroupMembersRef = useRef(groupMembersHook.fetchGroupMembers);

  fetchChannelsRef.current = fetchGroupChannels;
  fetchDmsRef.current = fetchDmsWithGroup;
  fetchMembersRef.current = chatMembersHook.fetchMembers;
  fetchGroupMembersRef.current = groupMembersHook.fetchGroupMembers;

  const debouncedFetchChannels = useCallback(async () => {
    clearTimeout(channelsDebounceRef.current);
    channelsDebounceRef.current = setTimeout(
      () => fetchChannelsRef.current(),
      3000,
    );
  }, []);

  const debouncedFetchDMs = useCallback(async () => {
    clearTimeout(dmsDebounceRef.current);
    dmsDebounceRef.current = setTimeout(() => fetchDmsRef.current(), 3000);
  }, []);

  const debouncedFetchMembers = useCallback(async () => {
    clearTimeout(membersDebounceRef.current);
    membersDebounceRef.current = setTimeout(
      () => fetchMembersRef.current(),
      3000,
    );
  }, []);

  const debouncedFetchGroupMembers = useCallback(async () => {
    clearTimeout(groupMembersDebounceRef.current);
    groupMembersDebounceRef.current = setTimeout(() => {
      const groupId = getGroupId();
      if (groupId) {
        fetchGroupMembersRef.current(groupId);
      }
    }, 3000);
  }, []);

  const mainMessagesRef = useRef(mainMessages);
  const threadMessagesRef = useRef(threadMessages);
  const playSoundForMessageRef = useRef(playSoundForMessage);
  const notifyMessageRef = useRef(notifyMessage);
  const notifyDMRef = useRef(notifyDM);
  const notifyChannelRef = useRef(notifyChannel);
  const notifyThreadRef = useRef(notifyThread);
  const onDMSelectedRef = useRef<
    (dm: DMContextInfo) => void
  >(() => {});

  mainMessagesRef.current = mainMessages;
  threadMessagesRef.current = threadMessages;
  playSoundForMessageRef.current = playSoundForMessage;
  notifyMessageRef.current = notifyMessage;
  notifyDMRef.current = notifyDM;
  notifyChannelRef.current = notifyChannel;
  notifyThreadRef.current = notifyThread;

  const onLeftChannelRef = useRef<(contextId: string) => void>(() => {});
  const subscribeToContextRef = useRef<(contextId: string) => void>(() => {});
  onLeftChannelRef.current = (_contextId: string) => {
    setActiveChat(null);
    activeChatRef.current = null;
    setIsOpenSearchChannel(true);
  };
  subscribeToContextRef.current = webSocket.subscribeToContext;

  // Maps kept in sync with the current channel + DM lists so background
  // message handlers can resolve contextId → identity / display name.
  const contextIdentityMapRef = useRef<Map<string, string>>(new Map());
  const contextNameMapRef = useRef<Map<string, string>>(new Map());
  // Set of context IDs that are DMs. Used in background message handlers to
  // correctly classify a context as DM vs channel even when event bytes fail to
  // parse (which would otherwise leave isDM = false for every context).
  const dmContextIdsRef = useRef<Set<string>>(new Set());
  const onUnreadRefreshRef = useRef<(contextId: string, contextIdentity: string) => Promise<void>>(
    async () => {},
  );
  onUnreadRefreshRef.current = refreshUnread;

  const onUnreadClearRef = useRef<(contextId: string, contextIdentity: string) => Promise<void>>(
    async () => {},
  );
  onUnreadClearRef.current = clearUnread;

  const chatHandlersRefs = useRef({
    mainMessages: mainMessagesRef,
    threadMessages: threadMessagesRef,
    playSoundForMessage: playSoundForMessageRef,
    notifyMessage: notifyMessageRef,
    notifyDM: notifyDMRef,
    notifyChannel: notifyChannelRef,
    notifyThread: notifyThreadRef,
    fetchDms: fetchDmsRef,
    onDMSelected: onDMSelectedRef,
    fetchChannels: { current: debouncedFetchChannels },
    fetchDMs: { current: debouncedFetchDMs },
    fetchMembers: { current: debouncedFetchMembers },
    fetchGroupMembers: { current: debouncedFetchGroupMembers },
    onLeftChannel: onLeftChannelRef,
    subscribeToContext: subscribeToContextRef,
    contextIdentityMap: contextIdentityMapRef,
    contextNameMap: contextNameMapRef,
    dmContextIds: dmContextIdsRef,
    onUnreadRefresh: onUnreadRefreshRef,
    onUnreadClear: onUnreadClearRef,
  }).current;

  const updateSelectedActiveChatRef = useRef(updateSelectedActiveChat);
  updateSelectedActiveChatRef.current = updateSelectedActiveChat;

  const onDMSelected = useCallback(
    async (dm: DMContextInfo) => {
      const contextId = dm.contextId;
      const groupId = getGroupId();

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

      let selectedDm = dm;
      let resolvedIdentity = dm.contextIdentity || dm.myIdentity;

      if (!dm.isJoined) {
        if (!groupId) {
          return;
        }

        const groupApi = new GroupApiDataSource();
        const joinResponse = await groupApi.joinGroupContext(groupId, {
          contextId,
        });
        if (joinResponse.error || !joinResponse.data) {
          log.warn(
            "Home",
            `Failed to join DM context ${contextId}: ${joinResponse.error?.message || "unknown error"}`,
          );
          return;
        }

        resolvedIdentity = joinResponse.data.memberPublicKey;
        setContextMemberIdentity(contextId, resolvedIdentity);
        // Seed server-side member alias so the other DM participant sees a
        // display name instead of a raw identity hash on rc.35.
        const namespaceIdentity = getGroupMemberIdentity(groupId);
        const seedAlias =
          (namespaceIdentity ? getIdentityDisplayName(namespaceIdentity) : "") ||
          getMessengerDisplayName() ||
          "";
        if (seedAlias && groupId && namespaceIdentity) {
          // Must use the NAMESPACE group ID + namespace identity, not the DM
          // context ID — setMemberAlias stores to the governance DAG which
          // listMembers(namespaceId) reads. Passing contextId here silently
          // hits a non-existent group and the alias is never stored.
          groupApi
            .setMemberMetadata(groupId, namespaceIdentity, { name: seedAlias })
            .catch(() => {/* non-fatal — alias is best-effort */});
          // Register WASM-level profile so the other node's get_profiles
          // returns our username. Without this, the other side always sees
          // "Direct message" because their useDMs otherUsername is "".
          new ClientApiDataSource()
            .joinChat({ contextId, executorPublicKey: resolvedIdentity, username: seedAlias, isDM: true })
            .catch(() => {/* non-fatal — set_profile is best-effort */});
        }
        const refreshedDms = await fetchDmsWithGroup();
        const refreshedDm = refreshedDms.find(
          (entry) => entry.contextId === contextId,
        );
        selectedDm =
          refreshedDm ??
          {
            ...dm,
            contextIdentity: resolvedIdentity,
            myIdentity: resolvedIdentity,
            isJoined: true,
          };
      }

      const selectedChat: ActiveChat = {
        type: "direct_message",
        contextId,
        id: contextId,
        name: getDmDisplayName({
          otherUsername: selectedDm.otherUsername,
          otherAlias: selectedDm.otherAlias,
          otherIdentity: selectedDm.otherIdentity,
          contextId: selectedDm.contextId,
        }),
        username: selectedDm.otherUsername || undefined,
        readOnly: false,
        isSynced: true,
        contextIdentity: resolvedIdentity,
      };

      if (resolvedIdentity) {
        setContextId(contextId);
        setExecutorPublicKey(resolvedIdentity);
      }

      mainMessagesRef.current.clear();
      threadMessagesRef.current.clear();

      await updateSelectedActiveChatRef.current(selectedChat);
    },
    [],
  );

  onDMSelectedRef.current = onDMSelected;

  const loadInitialChatMessages =
    useCallback(async (): Promise<ChatMessagesData> => {
      const result = await mainMessagesRef.current.loadInitial(
        activeChatRef.current,
      );

      if (
        activeChatRef.current?.type === "channel" &&
        result.messages.length > 0
      ) {
        const lastMessage = result.messages[result.messages.length - 1];
        if (lastMessage?.timestamp) {
          await new ClientApiDataSource().readMessage({
            channel: { name: activeChatRef.current.name },
            timestamp: lastMessage.timestamp,
          });
        }
      }

      return result;
    }, []);

  // Group-based channels (each context = one channel)
  const channels = useMemo(
    () => groupContextsHook.channels.filter(
      (ch) => (ch.isJoined ?? false) && (!ch.info || ch.info.context_type === "Channel"),
    ),
    [groupContextsHook.channels],
  );

  const privateDMs = dmsHook.dms;

  const chatMembers = chatMembersHook.members;
  const currentMemberIdentity =
    currentGroupPermissions.memberIdentity || getGroupMemberIdentity(currentGroupId);
  const dmMembers = useMemo(
    () =>
      buildDmMemberOptions({
        groupMembers: groupMembersHook.members,
        currentMemberIdentity,
        labelsByIdentity: chatMembers,
      }),
    [
      groupMembersHook.members,
      currentMemberIdentity,
      chatMembers,
    ],
  );

  const {
    handleThreadMessageUpdates,
    handleStateMutation,
  } = useChatHandlers(activeChatRef, activeChat, chatHandlersRefs);

  useWebSocketEvents(useCallback(async (event: WebSocketEvent) => {
    try {
      await handleStateMutation(event);

      if (openThread) {
        const sessionChat = getStoredSession();
        const useDM = sessionChat?.type === "direct_message";

        await handleThreadMessageUpdates(useDM, openThread.id);
      }
    } catch (error) {
      log.error("Home", "Error processing WebSocket event", error);
    }
  }, [handleStateMutation, handleThreadMessageUpdates, openThread]));

  const initialFetchDone = useRef(false);
  const isFetchingInitial = useRef(false);

  useEffect(() => {
    if (!initialFetchDone.current && !isFetchingInitial.current) {
      isFetchingInitial.current = true;

      const groupId = getGroupId();
      const fetchPromises: Promise<unknown>[] = [
        chatMembersHook.fetchMembers(),
      ];

      if (groupId) {
        fetchPromises.push(groupMembersHook.fetchGroupMembers(groupId));
        fetchPromises.push(groupContextsHook.fetchGroupContexts(groupId));
        fetchPromises.push(dmsHook.fetchDms(groupId));
      }

      Promise.all(fetchPromises)
        .then(() => {
          initialFetchDone.current = true;
          isFetchingInitial.current = false;
        })
        .catch((error) => {
          log.error("Home", "Error fetching initial data", error);
          isFetchingInitial.current = false;
        });
    }
  }, [dmsHook, chatMembersHook, groupContextsHook, groupMembersHook]);

  // Stable key — only changes when the actual set of context IDs changes
  const allContextIdsKey = useMemo(() => {
    const ids: string[] = [];
    groupContextsHook.channels.forEach((ch) => {
      if (ch.isJoined && ch.contextId) ids.push(ch.contextId);
    });
    privateDMs.forEach((dm) => {
      if (dm.contextId && !ids.includes(dm.contextId)) ids.push(dm.contextId);
    });
    return ids.sort().join(",");
  }, [groupContextsHook.channels, privateDMs]);

  // Keep contextIdentityMap and contextNameMap in sync whenever the channel/DM
  // lists change. These maps are read by background message handlers in
  // useChatHandlers without triggering re-renders.
  // Also snapshot the contexts list for unread loading (read inside the effect
  // via a ref to avoid stale-closure issues).
  const allContextsForUnreadRef = useRef<{ contextId: string; contextIdentity: string }[]>([]);
  useEffect(() => {
    const identityMap = new Map<string, string>();
    const nameMap = new Map<string, string>();
    const forUnread: { contextId: string; contextIdentity: string }[] = [];

    groupContextsHook.channels.forEach((ch) => {
      if (!ch.contextId) return;
      if (ch.contextIdentity) {
        identityMap.set(ch.contextId, ch.contextIdentity);
        if (ch.isJoined) forUnread.push({ contextId: ch.contextId, contextIdentity: ch.contextIdentity });
      }
      const name = ch.info?.name ?? ch.alias ?? ch.contextId.substring(0, 8);
      nameMap.set(ch.contextId, name);
    });

    const dmIds = new Set<string>();
    privateDMs.forEach((dm) => {
      if (!dm.contextId) return;
      dmIds.add(dm.contextId);
      if (dm.contextIdentity) {
        identityMap.set(dm.contextId, dm.contextIdentity);
        forUnread.push({ contextId: dm.contextId, contextIdentity: dm.contextIdentity });
      }
      const name = dm.otherUsername || dm.otherAlias || dm.contextId.substring(0, 8);
      nameMap.set(dm.contextId, name);
    });

    contextIdentityMapRef.current = identityMap;
    contextNameMapRef.current = nameMap;
    dmContextIdsRef.current = dmIds;
    allContextsForUnreadRef.current = forUnread;
  }, [groupContextsHook.channels, privateDMs]);

  // Load unread counts from WASM whenever the set of subscribed contexts changes.
  useEffect(() => {
    if (!allContextIdsKey) return;
    if (allContextsForUnreadRef.current.length > 0) {
      void loadAllUnread(allContextsForUnreadRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allContextIdsKey]);

  // Subscribe to ALL group contexts + DM contexts for real-time updates
  useEffect(() => {
    if (!app || !allContextIdsKey) return;

    const contextIds = allContextIdsKey.split(",");
    log.info("Home", `Subscribing to ${contextIds.length} contexts`, { totalContexts: contextIds.length });
    webSocket.subscribeToContexts(contextIds);
  }, [app, allContextIdsKey, webSocket]);

  // Poll DMs every 30s — catches deletions and new DMs on both nodes
  useEffect(() => {
    const interval = setInterval(() => { void fetchDmsRef.current(); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Poll channel list every 30s — catches channel deletions for all members
  useEffect(() => {
    const interval = setInterval(() => { void fetchChannelsRef.current(); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Poll namespace members every 60s — catches new members joining the workspace
  useEffect(() => {
    const interval = setInterval(() => { void debouncedFetchGroupMembers(); }, 60000);
    return () => clearInterval(interval);
  }, [debouncedFetchGroupMembers]);

  const onJoinedChat = async () => {
    fetchGroupChannels();
    await fetchDmsWithGroup();
    const activeChatCopy = { ...activeChat };
    if (activeChatCopy && activeChat) {
      activeChatCopy.canJoin = false;
      activeChatCopy.requiresProfileSetup = false;
      activeChatCopy.type = activeChat.type;
      activeChatCopy.id = activeChat.id;
      activeChatCopy.name = activeChat.name;
      activeChatCopy.readOnly = activeChat.readOnly;
    }
    setActiveChat(activeChatCopy as ActiveChat);
    activeChatRef.current = activeChatCopy as ActiveChat;
    updateSessionChat(activeChatCopy as ActiveChat);
  };

  const loadPrevMessages = useCallback(
    async (chatId: string): Promise<ChatMessagesDataWithOlder> => {
      return await mainMessagesRef.current.loadPrevious(
        activeChatRef.current,
        chatId,
      );
    },
    [],
  );

  /**
   * Create a DM using the group-based flow:
   * 1. Create a context in the group with type "Dm"
   * 2. Set visibility to restricted
   * 3. Add both participants to the allowlist
   * The other user discovers the DM via the group context list and joins.
   */
  const createDM = async (otherIdentity: string): Promise<CreateContextResult> => {
    const groupId = getGroupId();
    if (!groupId) {
      return { data: "", error: "No group ID configured" };
    }

    try {
      const nodeApi = new ContextApiDataSource();
      const groupApi = new GroupApiDataSource();
      const identityResponse = await groupApi.resolveCurrentMemberIdentity(
        groupId,
        getGroupMemberIdentity(groupId),
      );
      const myIdentity = identityResponse.data?.memberIdentity || "";
      if (!myIdentity) {
        return {
          data: "",
          error:
            identityResponse.error?.message ||
            "Could not resolve your workspace identity",
        };
      }
      setGroupMemberIdentity(groupId, myIdentity);
      if (myIdentity === otherIdentity) {
        return {
          data: "",
          error: "Cannot create DM: you cannot DM yourself",
        };
      }

      const existingDm = privateDMs.find((dm) => dm.otherIdentity === otherIdentity);
      if (existingDm) {
        return { data: "", error: "Cannot create DM: already exists" };
      }

      const otherUsername = dmMembers.get(otherIdentity) || chatMembers.get(otherIdentity) || "";
      const myUsername = getIdentityDisplayName(myIdentity) || getMessengerDisplayName();

      // 1-group-per-context model: DM = a new restricted subgroup under the
      // namespace + one context inside. The helper handles both steps and
      // adds the other identity as a member of the new DM subgroup.
      const createResponse = await createDmContextInGroup({
        applicationId: getApplicationId(),
        groupId,
        myIdentity,
        myUsername,
        otherIdentity,
        otherUsername,
        contextApi: nodeApi,
        groupApi,
        onWarning: (message) => log.warn("createDM", message),
      });
      if (createResponse.error || !createResponse.data) {
        return {
          data: "",
          error: createResponse.error || "Failed to create DM context",
        };
      }

      await fetchDmsWithGroup();
      fetchGroupChannels();

      return { data: "DM created successfully", error: "" };
    } catch (error) {
      console.error("createDM failed:", error);
      return {
        data: "",
        error: error instanceof Error ? error.message : "Failed to create DM",
      };
    }
  };

  const loadInitialThreadMessages = useCallback(
    async (parentMessageId: string): Promise<ChatMessagesData> => {
      log.debug(
        "Home",
        `loadInitialThreadMessages called for parent: ${parentMessageId}`,
      );
      const result = await threadMessagesRef.current.loadInitial(
        activeChatRef.current,
        parentMessageId,
      );
      log.debug("Home", `loadInitialThreadMessages result:`, result);
      return result;
    },
    [],
  );

  const updateCurrentOpenThread = useCallback(
    (thread: CurbMessage | undefined) => {
      setCurrentOpenThread(thread);
    },
    [],
  );

  const loadPrevThreadMessages = useCallback(
    async (parentMessageId: string): Promise<ChatMessagesDataWithOlder> => {
      return await threadMessagesRef.current.loadPrevious(
        activeChatRef.current,
        parentMessageId,
      );
    },
    [],
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
      subgroups={groupContextsHook.subgroups}
      channelsBySubgroup={groupContextsHook.channelsBySubgroup}
      fetchChannels={fetchGroupChannels}
      onChannelCreated={fetchGroupChannels}
      onChannelLeft={groupContextsHook.removeChannel}
      onChannelJoined={groupContextsHook.unblockChannel}
      getSubgroupForContext={groupContextsHook.getSubgroupForContext}
      onJoinedChat={onJoinedChat}
      loadPrevMessages={loadPrevMessages}
      chatMembers={chatMembers}
      dmMembers={dmMembers}
      createDM={createDM}
      privateDMs={privateDMs}
      onFetchDmMembers={debouncedFetchGroupMembers}
      unreadCounts={unreadCounts}
      loadInitialThreadMessages={loadInitialThreadMessages}
      incomingThreadMessages={threadMessages.incomingMessages}
      clearThreadsMessagesOnSwitch={threadMessages.clear}
      loadPrevThreadMessages={loadPrevThreadMessages}
      updateCurrentOpenThread={updateCurrentOpenThread}
      openThread={openThread}
      setOpenThread={setOpenThread}
      currentOpenThreadRef={currentOpenThreadRef}
      addOptimisticMessage={addOptimisticMessage}
      addOptimisticThreadMessage={addOptimisticThreadMessage}
      wsIsSubscribed={webSocket.isSubscribed()}
      wsContextId={webSocket.getSubscribedContexts().join(", ") || null}
      wsSubscriptionCount={webSocket.getSubscriptionCount()}
      searchResults={searchResults}
      searchTotalCount={searchTotalCount}
      searchQuery={searchQuery}
      isSearchingMessages={isSearchingMessages}
      searchHasMore={searchHasMore}
      searchError={searchError}
      onSearchMessages={handleSearchMessages}
      onLoadMoreSearch={handleLoadMoreSearch}
      onClearSearch={handleClearSearch}
    />
  );
}
