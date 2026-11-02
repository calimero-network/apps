import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppContainer from "../../components/common/AppContainer";
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
import { setContextId } from "../../calimero/context";
import { selfAccount } from "../../calimero/connection";
import { WorkspaceProvider } from "../../calimero/WorkspaceProvider";
import { getDmDisplayName, useWorkspaceLists } from "../../hooks/useWorkspaceLists";
import type { CreateContextResult } from "../../components/popups/StartDMPopup";
import type { DMContextInfo } from "../../types/Common";
import { useAppNotifications } from "../../hooks/useAppNotifications";
import { SUBSCRIPTION_INIT_DELAY_MS } from "../../constants/app";
import { log } from "../../utils/logger";
import type { WebSocketEvent } from "../../types/WebSocketTypes";
import { useChatMembers } from "../../hooks/useChatMembers";
import { useChannelMembers } from "../../hooks/useChannelMembers";
import { useMessages } from "../../hooks/useMessages";
import {
  resultPosition,
  type SearchContext,
  type SearchResult,
} from "../../hooks/messageSearch";
import { useThreadMessages } from "../../hooks/useThreadMessages";
import { useWebSocket, useWebSocketEvents } from "../../contexts/WebSocketContext";
import { useChatHandlers } from "../../hooks/useChatHandlers";
import { getGroupId, setGroupId } from "../../constants/config";
import { sameAccount } from "../../utils/accountIdentity";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { useAppBadge } from "../../hooks/useAppBadge";
import { useToast } from "../../contexts/ToastContext";
import {
  messagePermalink,
  parseMessagePermalink,
  resolveMessageLink,
} from "../../utils/permalink";
import type { MessageLink } from "../../utils/permalink";

/**
 * One workspace: its channels and DMs in the sidebar, the open conversation,
 * threads, search and live events. The workspace (an organization) and the
 * conversations it holds come from `WorkspaceProvider`.
 */
export default function Home({
  org,
  onLeaveWorkspace,
  onSignOut,
}: {
  org: string;
  onLeaveWorkspace: () => void;
  onSignOut: () => void;
}) {
  const onSwitch = useCallback(
    (next: string) => {
      if (next) setGroupId(next);
      onLeaveWorkspace();
      if (next) window.setTimeout(() => window.location.reload(), 0);
    },
    [onLeaveWorkspace],
  );
  return (
    <WorkspaceProvider org={org} onSwitch={onSwitch} onSignOut={onSignOut}>
      <WorkspaceHome />
    </WorkspaceProvider>
  );
}

function WorkspaceHome() {
  const [isOpenSearchChannel, setIsOpenSearchChannel] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  // ── Message permalinks ────────────────────────────────────────────────────
  //
  // Read once, from the URL that opened the app. Held in a ref as well as
  // state because `loadInitialChatMessages` is a stable callback and must see
  // the current value without being rebuilt (rebuilding it would retrigger the
  // message list's load effect).
  const [pendingLink] = useState<MessageLink | null>(() =>
    typeof window === "undefined"
      ? null
      : parseMessagePermalink(window.location.search),
  );
  const pendingLinkRef = useRef<MessageLink | null>(pendingLink);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [messagesReloadKey, setMessagesReloadKey] = useState(0);
  const { addToast } = useToast();
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
    searchHasMore,
    searchQuery,
    isSearching: isSearchingMessages,
    searchAllContexts: executeSearchAllContexts,
    loadMoreSearch,
    clearSearch: clearMessageSearch,
    searchError,
  } = mainMessages;

  const {
    notifyMessage,
    notifyDM,
    notifyChannel,
    notifyThread,
    playSoundForMessage,
    playSound,
  } = useAppNotifications(activeChat?.id);

  // Group-based channel list (replaces old useChannels)
  const { groupContextsHook, dmsHook, groupMembersHook, dmMembers, ws } = useWorkspaceLists();
  const privateDMs = dmsHook.dms;
  const chatMembersHook = useChatMembers();
  const channelMembersHook = useChannelMembers();
  const { counts: unreadCounts, loadAll: loadAllUnread, refreshOne: refreshUnread, clearOne: clearUnread } = useUnreadCounts();

  // Reflect total unread on the native dock badge (Calimero desktop launcher).
  useAppBadge(unreadCounts);

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
    currentOpenThreadRef.current = currentOpenThread;
  }, [currentOpenThread]);

  // No conversation open (a first visit): show the channel list to pick one.
  useEffect(() => {
    if (!activeChat && !getStoredSession()) setIsOpenSearchChannel(true);
  }, [activeChat]);

  const getChannelUsersRef = useRef(channelMembersHook.fetchChannelMembers);
  getChannelUsersRef.current = channelMembersHook.fetchChannelMembers;

  const getChannelUsers = useCallback(async (id: string, subgroupId?: string) => {
    return getChannelUsersRef.current(id, subgroupId);
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
    // profile yet (the typical state for freshly-added users).
    //
    // No namespaceId: display names no longer come from this call at all.
    // They are resolved per account by the name repository, which reads the
    // namespace member metadata itself.
    const contextId = activeChatRef.current?.contextId ?? activeChatRef.current?.id;
    const subgroupId = contextId
      ? getSubgroupForContextRef.current(contextId)
      : undefined;
    await getChannelUsersRef.current(channelId, subgroupId);
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
      resolvedChat = {
        ...selectedChat,
        contextIdentity: selfAccount(),
        canJoin: false,
        requiresProfileSetup: false,
      };
      setContextId(selectedChat.contextId);
      webSocket.subscribeToContexts([selectedChat.contextId]);
    }

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

    const chatId = resolvedChat.id || resolvedChat.name;
    if (lastSelectedChatIdRef.current !== chatId) {
      lastSelectedChatIdRef.current = chatId;

      if (resolvedChat.type === "channel" && resolvedChat.contextIdentity) {
        const subgroupId = resolvedChat.contextId
          ? getSubgroupForContextRef.current(resolvedChat.contextId)
          : undefined;
        getChannelUsers(resolvedChat.id, subgroupId);
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
      const contexts: SearchContext[] = [];

      groupContextsHook.channels.forEach((ch) => {
        if (ch.isJoined && ch.contextId && ch.contextIdentity) {
          contexts.push({
            contextId: ch.contextId,
            executorPublicKey: ch.contextIdentity,
            label:
              ch.info?.name ?? ch.alias ?? ch.contextId.substring(0, 8),
          });
        }
      });

      privateDMs.forEach((dm) => {
        if (dm.contextId && dm.contextIdentity) {
          contexts.push({
            contextId: dm.contextId,
            executorPublicKey: dm.contextIdentity,
            label: getDmDisplayName({
              otherUsername: dm.otherUsername,
              otherAlias: dm.otherAlias,
              otherIdentity: dm.otherIdentity,
              contextId: dm.contextId,
            }),
          });
        }
      });

      // Nothing listed yet: the open conversation is still searchable.
      const open = activeChatRef.current;
      if (contexts.length === 0 && open?.contextId && open.contextIdentity) {
        contexts.push({
          contextId: open.contextId,
          executorPublicKey: open.contextIdentity,
          label: open.name,
        });
      }

      await executeSearchAllContexts(contexts, query);
    },
    [groupContextsHook.channels, privateDMs, executeSearchAllContexts],
  );

  const handleLoadMoreSearch = useCallback(async () => {
    await loadMoreSearch();
  }, [loadMoreSearch]);

  const handleClearSearch = useCallback(() => {
    clearMessageSearch();
  }, [clearMessageSearch]);

  /**
   * Open a result where it was said: the conversation, loaded around the
   * hit (around its parent, for a thread reply), through the same path a
   * permalink takes. A result with no position just opens the conversation.
   */
  const handleResultClick = useCallback(
    async (result: SearchResult) => {
      const { contextId } = result;
      const api = new ClientApiDataSource();
      const index = await resultPosition(result, (props) =>
        api.messagePosition(props),
      );
      pendingLinkRef.current =
        index !== null
          ? { contextId, index, messageId: result.indexMessageId }
          : null;
      if (activeChatRef.current?.contextId === contextId) {
        // Already open: reload the list so it consumes the link.
        setMessagesReloadKey((key) => key + 1);
        return;
      }
      const channel = groupContextsHook.channels.find(
        (ch) => ch.contextId === contextId && ch.isJoined && ch.contextIdentity,
      );
      if (channel && channel.contextIdentity) {
        void updateSelectedActiveChatRef.current({
          type: "channel",
          contextId,
          id: contextId,
          name:
            channel.info?.name ?? channel.alias ?? contextId.substring(0, 8),
          contextIdentity: channel.contextIdentity,
        });
        return;
      }
      const dm = privateDMs.find((d) => d.contextId === contextId);
      if (dm && dm.contextIdentity) {
        void updateSelectedActiveChatRef.current({
          type: "direct_message",
          contextId,
          id: contextId,
          name: getDmDisplayName({
            otherUsername: dm.otherUsername,
            otherAlias: dm.otherAlias,
            otherIdentity: dm.otherIdentity,
            contextId: dm.contextId,
          }),
          contextIdentity: dm.contextIdentity,
        });
      }
    },
    [groupContextsHook.channels, privateDMs],
  );

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

  // Called when the New DM popup opens — refresh both the member list and the
  // DM list so the popup's dropdown excludes contacts who already have a DM.
  // Bypasses the debounce so isRefreshing stays true until data actually arrives
  // (debouncedFetchGroupMembers resolves immediately, causing the spinner to
  // disappear 3 s before members load — making the first open look empty).
  const onFetchDmMembersForPopup = useCallback(async () => {
    const groupId = getGroupId();
    const fetches: Promise<unknown>[] = [fetchDmsWithGroup()];
    if (groupId) fetches.push(fetchGroupMembersRef.current(groupId));
    await Promise.all(fetches);
  }, [fetchDmsWithGroup]);

  const mainMessagesRef = useRef(mainMessages);
  const refreshReactedMessageRef = useRef(mainMessages.refreshReactedMessage);
  refreshReactedMessageRef.current = mainMessages.refreshReactedMessage;
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
    refreshReactedMessage: refreshReactedMessageRef,
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

      const selectedDm = dm;
      const resolvedIdentity = selfAccount();

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

      setContextId(contextId);

      mainMessagesRef.current.clear();
      threadMessagesRef.current.clear();

      await updateSelectedActiveChatRef.current(selectedChat);
    },
    [],
  );

  onDMSelectedRef.current = onDMSelected;

  const loadInitialChatMessages =
    useCallback(async (): Promise<ChatMessagesData> => {
      // A pending permalink is consumed HERE rather than in an effect of its
      // own, because this is the one function the message list calls to fill
      // itself. Loading the link's window anywhere else would race the normal
      // load and lose — the list would briefly show the linked conversation
      // and then replace it with the newest page.
      const link = pendingLinkRef.current;
      if (link && activeChatRef.current?.contextId === link.contextId) {
        pendingLinkRef.current = null;
        const window = await mainMessagesRef.current.openMessageLink(
          activeChatRef.current,
          link.index,
        );
        const resolution = resolveMessageLink(window.messages, link);
        if (resolution.status === "found") {
          setFocusMessageId(resolution.message.id);
          return window;
        }

        // Either the position holds nothing, or it holds a different message
        // than the link named. Both mean the link cannot be honoured, and
        // showing whatever happens to sit at that position would be the one
        // failure a permalink must never have: the reader sees a real message
        // in a real conversation with no way to tell it is the wrong one.
        //
        // Falling through to the normal load also avoids rendering the link's
        // empty window, which read as "No messages yet" for a channel full of
        // messages.
        setFocusMessageId(null);
        addToast({
          title: "Message not found",
          message:
            resolution.status === "mismatch"
              ? "That link points to a message that is no longer here. Showing the latest messages instead."
              : "That link points to a message this channel doesn't have. Showing the latest messages instead.",
          type: "channel",
          duration: 5000,
        });
      }

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

  /**
   * Open the channel a permalink points at, once it is known to this node.
   *
   * Only selects the channel; the message window itself is loaded by
   * `loadInitialChatMessages`, which the list calls when the channel changes.
   * Runs on every channel-list update because a link is routinely opened
   * before the channel it names has finished loading.
   */
  useEffect(() => {
    const link = pendingLinkRef.current;
    if (!link) return;
    if (activeChatRef.current?.contextId === link.contextId) return;

    const channel = groupContextsHook.channels.find(
      (ch) =>
        ch.contextId === link.contextId && ch.isJoined && ch.contextIdentity,
    );
    if (!channel?.contextIdentity) return; // Not synced yet — try again later.

    void updateSelectedActiveChatRef.current({
      type: "channel",
      contextId: link.contextId,
      id: link.contextId,
      name:
        channel.info?.name ?? channel.alias ?? link.contextId.substring(0, 8),
      contextIdentity: channel.contextIdentity,
    });
  }, [groupContextsHook.channels]);

  /** Put a link to one message on the clipboard. */
  const copyMessageLink = useCallback((message: CurbMessage) => {
    const contextId = activeChatRef.current?.contextId;
    // A message with no index has no position to link to yet — an optimistic
    // send that the node has not accepted. Better no link than one that points
    // at whatever later lands in that slot.
    if (!contextId || message.index === undefined) {
      addToast({
        title: "Can't link this message yet",
        message: "It hasn't been accepted by the node, so it has no position.",
        type: "channel",
        duration: 4000,
      });
      return;
    }

    const url = messagePermalink({
      contextId,
      index: message.index,
      messageId: message.id,
    });
    void navigator.clipboard
      ?.writeText(url)
      .then(() =>
        addToast({
          title: "Link copied",
          message: "Anyone in this channel can open it.",
          type: "channel",
          duration: 3000,
        }),
      )
      .catch(() =>
        addToast({
          title: "Could not copy the link",
          message: "Copying was blocked; try again from a focused window.",
          type: "channel",
          duration: 4000,
        }),
      );
  }, [addToast]);

  /** Leave a permalink's window and load the newest messages again. */
  const jumpToPresent = useCallback(() => {
    setFocusMessageId(null);
    pendingLinkRef.current = null;
    setMessagesReloadKey((key) => key + 1);
  }, []);

  // Group-based channels (each context = one channel)
  const channels = useMemo(
    () => groupContextsHook.channels.filter(
      (ch) => (ch.isJoined ?? false) && (!ch.info || ch.info.context_type === "Channel"),
    ),
    [groupContextsHook.channels],
  );

  const chatMembers = chatMembersHook.members;

  const {
    handleThreadMessageUpdates,
    handleStateMutation,
  } = useChatHandlers(activeChatRef, activeChat, chatHandlersRefs);

  // Subscribe to the workspace group so membership changes arrive live
  // instead of waiting on the 30s channel/member polls below.

  // Learn this node's ACCOUNT id for the workspace. The contract stamps
  // `sender` with the account id, while everything else the app holds is a
  // device id — without this, no message can ever be recognised as our own.
  // It also decides which slot of a DM's participant metadata is "the other
  // person" (info.creator is an account id). The first DM fetch can win the
  // race against this async load, which would render our own name as the DM
  // title, so refresh the DM list once the account id is registered.

  useWebSocketEvents(useCallback(async (event: WebSocketEvent) => {
    try {
      // Membership events carry no `data.events`, so handleStateMutation
      // would drop them. A join/add/remove changes who is in the workspace
      // and which channels we can see — refresh both.
      if (event.type === "GroupMembership") {
        log.info("Home", `[SSE] membership ${event.membershipKind} on ${event.groupId}`);
        void fetchChannelsRef.current();
        void fetchMembersRef.current();
        return;
      }

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

      const fetchPromises: Promise<unknown>[] = [
        chatMembersHook.fetchMembers(),
      ];

      const groupId = getGroupId();
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
        .catch((error: unknown) => {
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
  // Live events stream for the open conversation only (a browser holds few
  // connections to a node); the others' unread counts are polled.
  useEffect(() => {
    if (!allContextIdsKey) return;
    const timer = setInterval(() => {
      const open = activeChatRef.current?.contextId;
      const others = allContextsForUnreadRef.current.filter((c) => c.contextId !== open);
      if (others.length > 0) void loadAllUnread(others);
    }, 30000);
    return () => clearInterval(timer);
  }, [allContextIdsKey, loadAllUnread]);

  // A dropped event stream is resumed by the provider from the last event it
  // saw (`client.events(app, from)`), so nothing is skipped; the workspace is
  // re-read every 30 s by `WorkspaceProvider`.


  // Poll channel list every 30s — catches channel deletions for all members

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
  /** The DM with `otherIdentity`: opened if it exists, else created (`accounts` access). */
  const createDM = async (otherIdentity: string): Promise<CreateContextResult> => {
    if (sameAccount(selfAccount(), otherIdentity)) {
      return { data: "", error: "Cannot create DM: you cannot DM yourself" };
    }
    try {
      const contextId = await ws.openDm(otherIdentity);
      const name = dmMembers.get(otherIdentity) || "";
      void updateSelectedActiveChatRef.current({
        type: "direct_message",
        contextId,
        id: contextId,
        name: getDmDisplayName({ otherUsername: name, otherIdentity, contextId }),
        contextIdentity: selfAccount(),
      });
      return { data: "DM created successfully", error: "" };
    } catch (error) {
      log.error("Home", "createDM failed", error);
      return { data: "", error: error instanceof Error ? error.message : "Failed to create DM" };
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
      focusMessageId={focusMessageId}
      copyMessageLink={copyMessageLink}
      onJumpToPresent={focusMessageId ? jumpToPresent : undefined}
      reloadKey={messagesReloadKey}
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
      onFetchDmMembers={onFetchDmMembersForPopup}
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
      searchQuery={searchQuery}
      isSearchingMessages={isSearchingMessages}
      searchHasMore={searchHasMore}
      searchError={searchError}
      onSearchMessages={handleSearchMessages}
      onLoadMoreSearch={handleLoadMoreSearch}
      onClearSearch={handleClearSearch}
      onSearchResultClick={handleResultClick}
    />
  );
}
