import { useState, useRef, useCallback } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "../api/types";
import type { FullMessageResponse } from "../api/clientApi";
import {
  applyPage,
  failPage,
  hasMore,
  isMissingMethod,
  isSearchOff,
  legacyPage,
  mapConcurrent,
  nextToFetch,
  SEARCH_CONCURRENCY,
  SEARCH_MAX_ROUNDS,
  SEARCH_PAGE_SIZE,
  SEARCH_TIMEOUT_MS,
  startSearch,
  visibleResults,
  withTimeout,
  type ContextSearch,
  type SearchContext,
  type SearchResult,
} from "./messageSearch";
import type {
  ActiveChat,
  CurbMessage,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
} from "../types/Common";
import {
  transformMessageToUI,
  transformMessagesToUI,
} from "../utils/messageTransformers";
import {
  MESSAGE_PAGE_SIZE,
} from "../constants/app";

/**
 * How much conversation to load either side of a linked message.
 *
 * Enough to read the exchange it belongs to; a single message out of context
 * is rarely what the person sharing the link meant.
 */
const PERMALINK_RADIUS = 25;
import { bindChannel, messageSync } from "../repositories/messages";
import { getContextId } from "@calimero-network/mero-react";

/**
 * Custom hook for managing messages in a chat
 * Handles loading, pagination, and incoming messages
 */
export function useMessages() {
  const [messages, setMessages] = useState<CurbMessage[]>([]);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const messagesRef = useRef<CurbMessage[]>([]);
  /**
   * The search in progress: its query, each context's pages so far, and a
   * generation that a newer search or a clear bumps, so a slow page from an
   * old search is dropped rather than painted over the new one.
   */
  const searchRef = useRef<{
    query: string;
    states: ContextSearch[];
    generation: number;
  }>({ query: "", states: [], generation: 0 });
  /**
   * Index of the oldest message currently on screen — where scrolling up
   * continues from. Deliberately NOT the store's low bound: a catch-up can
   * leave the store holding far more than is painted, and continuing from the
   * store would return a block that does not join onto the view.
   */
  const oldestShownRef = useRef<number | null>(null);

  /**
   * Load initial messages for a chat
   */
  const loadInitial = useCallback(
    async (activeChat: ActiveChat | null): Promise<ChatMessagesData> => {
      if (!activeChat?.name) {
        return { messages: [], totalCount: 0, hasMore: false };
      }

      const isDM = activeChat.type === "direct_message";
      const contextId = getContextId() || "";
      bindChannel({
        contextId,
        group: { name: (isDM ? "private_dm" : activeChat.name) || "" },
        isDm: isDM,
        dmIdentity: activeChat.contextIdentity,
      });

      // Paint what is on disk first. A channel opened after two hours away
      // shows its conversation immediately rather than an empty pane with a
      // spinner over it, and shows it even when the node cannot be reached.
      const stored = await messageSync.newest(contextId, MESSAGE_PAGE_SIZE);
      if (stored.length > 0) {
        oldestShownRef.current = stored[0].index;
        const painted = transformMessagesToUI(stored);
        messagesRef.current = painted;
        setMessages(painted);
      }

      try {
        // Then reconcile. On a current channel this costs one count call and
        // transfers nothing.
        await messageSync.catchUp(contextId);

        // And re-read the window, which catchUp cannot do. catchUp walks
        // forward from the cursor, so it only ever learns about APPENDS — but
        // a message is not immutable. A reaction changes an existing message
        // without changing the count, so catchUp fetches nothing and the
        // stored copy keeps whatever reactions it had when it was written.
        //
        // That is what made reactions vanish on reload: the row was painted
        // from disk, catchUp saw no gap, and the reaction added after the row
        // was stored existed only on the node. Before history was stored at
        // all, every open re-fetched and the question never arose.
        await messageSync.refreshNewest(contextId, MESSAGE_PAGE_SIZE);
      } catch (error) {
        // The node is unreachable. What was painted above is still the best
        // answer available, so this is not a failure of the open — it is a
        // stale view that the next catch-up repairs.
        console.warn("catchUp failed; showing stored history", error);
        return {
          messages: messagesRef.current,
          totalCount: messagesRef.current.length,
          hasMore: messagesRef.current.length > 0,
        };
      }

      const fresh = await messageSync.newest(contextId, MESSAGE_PAGE_SIZE);
      oldestShownRef.current = fresh[0]?.index ?? null;
      const messagesArray = transformMessagesToUI(fresh);
      messagesRef.current = messagesArray;
      setMessages(messagesArray);

      const cursor = await messageSync.cursor(contextId);
      const total = cursor?.knownTotal ?? messagesArray.length;
      setTotalCount(total);

      return {
        messages: messagesArray,
        totalCount: total,
        // More history exists below what is painted whenever the local window
        // does not reach the first message.
        hasMore: (oldestShownRef.current ?? 0) > 0,
      };
    },
    [],
  );

  /**
   * Load previous (older) messages for pagination
   */
  const loadPrevious = useCallback(
    async (
      activeChat: ActiveChat | null,
      _chatId: string,
    ): Promise<ChatMessagesDataWithOlder> => {
      if (!activeChat) {
        return { messages: [], totalCount, hasOlder: false };
      }

      const contextId = getContextId() || "";

      try {
        // Storage answers first and the node is asked only for what storage
        // does not hold — and whatever is fetched is written down, so the same
        // scroll never costs a second request.
        const older = await messageSync.loadOlder(
          contextId,
          MESSAGE_PAGE_SIZE,
          oldestShownRef.current ?? undefined,
        );
        if (older.length > 0) oldestShownRef.current = older[0].index;
        const messagesArray = transformMessagesToUI(older);
        const cursor = await messageSync.cursor(contextId);
        return {
          messages: messagesArray,
          totalCount: cursor?.knownTotal ?? totalCount,
          // More to scroll to whenever the view has not reached the first
          // message — again a property of the VIEW, not of store coverage.
          hasOlder: (oldestShownRef.current ?? 0) > 0,
        };
      } catch (error) {
        // Offline mid-scroll. Report no older messages rather than "you have
        // reached the beginning": the caller can ask again, and claiming the
        // channel ends here would be wrong.
        console.warn("loadOlder failed", error);
        return { messages: [], totalCount, hasOlder: true };
      }
    },
    [totalCount],
  );

  /**
   * Open a link to one message: load the conversation around it.
   *
   * `PERMALINK_RADIUS` messages either side, which is enough to read the
   * exchange the link was pointing at rather than one orphaned line.
   *
   * Note what this does NOT do: it does not move the channel's cursor, and it
   * leaves the view showing a window from the middle of the history. Scrolling
   * up continues from the top of that window, but there is no path back down to
   * the newest messages from here — returning to the present means loading the
   * channel again. A "jump to present" affordance should call `loadInitial`.
   */
  const openMessageLink = useCallback(
    async (
      activeChat: ActiveChat | null,
      index: number,
    ): Promise<ChatMessagesData> => {
      if (!activeChat?.name) {
        return { messages: [], totalCount: 0, hasMore: false };
      }

      const isDM = activeChat.type === "direct_message";
      const contextId = getContextId() || "";
      bindChannel({
        contextId,
        group: { name: (isDM ? "private_dm" : activeChat.name) || "" },
        isDm: isDM,
        dmIdentity: activeChat.contextIdentity,
      });

      try {
        const around = await messageSync.loadAround(
          contextId,
          index,
          PERMALINK_RADIUS,
        );
        if (around.length === 0) {
          // The link points past the end of this channel — a stale link, or one
          // for a channel this node has not synced. Better to show nothing than
          // to silently open somewhere else and look like it worked.
          return { messages: [], totalCount: 0, hasMore: false };
        }

        oldestShownRef.current = around[0].index;
        const messagesArray = transformMessagesToUI(around);
        messagesRef.current = messagesArray;
        setMessages(messagesArray);

        const cursor = await messageSync.cursor(contextId);
        setTotalCount(cursor?.knownTotal ?? messagesArray.length);

        return {
          messages: messagesArray,
          totalCount: cursor?.knownTotal ?? messagesArray.length,
          hasMore: around[0].index > 0,
        };
      } catch (error) {
        console.warn("openMessageLink failed", error);
        return { messages: [], totalCount: 0, hasMore: false };
      }
    },
    [],
  );

  /**
   * Check for and add new messages from websocket events
   * Includes aggressive rate limiting to prevent API hammering
   */
  const checkForNewMessages = useCallback(
    async (
      activeChat: ActiveChat | null,
      isDM: boolean,
      group: string,
      _contextId: string,
    ): Promise<CurbMessage[]> => {
      if (!activeChat) return [];

      // Removed throttling to allow real-time message updates

      // Wide enough to cover what is on screen, not just the newest few.
      // This asked for RECENT_MESSAGES_CHECK_SIZE (5), which is right for "did
      // anything arrive" and wrong for "did anything CHANGE": a reaction on a
      // message older than the last five was never in the refreshed page, so
      // there was nothing to merge and the reaction never appeared. It updated
      // or not depending on how far up the message was, which is what made it
      // look intermittent.
      const response: ResponseData<FullMessageResponse> =
        await new ClientApiDataSource().getMessages({
          group: {
            name: (isDM ? "private_dm" : group) || "",
          },
          limit: MESSAGE_PAGE_SIZE,
          offset: 0,
          is_dm: isDM,
          dm_identity: activeChat.contextIdentity,
          parent_message: undefined, // Only get main chat messages, not thread messages
        });

      if (!response.data) return [];

      // Transform messages - MessageStore will handle deduplication
      const newMessages = response.data.messages.map((msg) =>
        transformMessageToUI(msg),
      );

      if (newMessages.length > 0) {
        // Only update ref, not state (MessageStore will deduplicate in VirtualizedChat)
        messagesRef.current = [...messagesRef.current, ...newMessages];
        return newMessages;
      }

      return [];
    },
    [],
  );

  /**
   * Clear current search state
   */
  const clearSearch = useCallback(() => {
    const search = searchRef.current;
    searchRef.current = { query: "", states: [], generation: search.generation + 1 };
    setSearchResults([]);
    setSearchHasMore(false);
    setSearchQuery("");
    setSearchError(null);
    setIsSearching(false);
  }, []);

  /**
   * Read pages until at least `target` hits can be shown, every context is
   * finished, or `SEARCH_MAX_ROUNDS` rounds were read. `first` reads one page
   * of every context; later rounds read the contexts holding the merge back.
   */
  const fillSearch = useCallback(
    async (target: number, first: boolean): Promise<void> => {
      const search = searchRef.current;
      const { generation, query } = search;
      const api = new ClientApiDataSource();

      const fetchPage = async (state: ContextSearch): Promise<ContextSearch> => {
        const { contextId, executorPublicKey } = state.context;
        try {
          const response = await withTimeout(
            api.searchMessages({
              query,
              cursor: state.cursor,
              limit: SEARCH_PAGE_SIZE,
              contextId,
              executorPublicKey,
            }),
            SEARCH_TIMEOUT_MS,
          );
          if (response.data) return applyPage(state, response.data);
          const message = response.error?.message ?? "Search failed";
          if (isSearchOff(message)) {
            // A node running with search off: the same page, by walking the channel.
            const scanned = await withTimeout(
              api.searchMessagesScan({
                query,
                cursor: state.cursor,
                limit: SEARCH_PAGE_SIZE,
                contextId,
                executorPublicKey,
              }),
              SEARCH_TIMEOUT_MS,
            );
            return scanned.data
              ? applyPage(state, scanned.data)
              : failPage(state, scanned.error?.message ?? "Search failed");
          }
          if (!isMissingMethod(message)) return failPage(state, message);
          // An app version from before `search_messages`: its one page.
          const legacy = await withTimeout(
            api.searchAllMessages({
              search_term: query,
              limit: 50,
              offset: 0,
              contextId,
              executorPublicKey,
            }),
            SEARCH_TIMEOUT_MS,
          );
          return legacy.data
            ? applyPage(state, legacyPage(legacy, query))
            : failPage(state, legacy.error?.message ?? "Search failed");
        } catch (error) {
          return failPage(
            state,
            error instanceof Error ? error.message : "Search failed",
          );
        }
      };

      const publish = (states: ContextSearch[]) => {
        const failed = states.filter((s) => s.error);
        setSearchResults(visibleResults(states));
        setSearchHasMore(hasMore(states));
        setSearchError(
          failed.length === 0
            ? null
            : failed.length === states.length
              ? (failed[0].error ?? "Search failed")
              : `${failed.length} of ${states.length} conversations could not be searched`,
        );
      };

      setIsSearching(true);
      try {
        for (let round = 0; round < SEARCH_MAX_ROUNDS; round++) {
          const states = searchRef.current.states;
          const picked =
            first && round === 0
              ? states.map((_, i) => i)
              : nextToFetch(states, SEARCH_CONCURRENCY);
          if (picked.length === 0) break;
          const pages = await mapConcurrent(picked, SEARCH_CONCURRENCY, (i) =>
            fetchPage(states[i]),
          );
          if (searchRef.current.generation !== generation) return;
          const next = [...searchRef.current.states];
          picked.forEach((i, n) => {
            next[i] = pages[n];
          });
          searchRef.current = { ...searchRef.current, states: next };
          publish(next);
          if (!hasMore(next) || visibleResults(next).length >= target) break;
        }
      } finally {
        if (searchRef.current.generation === generation) setIsSearching(false);
      }
    },
    [],
  );

  /**
   * Search `contexts` for `query`: the first page of each, merged newest
   * first. `loadMoreSearch` continues from each context's cursor.
   */
  const searchAllContexts = useCallback(
    async (contexts: SearchContext[], query: string): Promise<void> => {
      const normalizedQuery = query.trim();
      clearSearch();
      setSearchQuery(normalizedQuery);
      if (!normalizedQuery || contexts.length === 0) return;

      searchRef.current = {
        query: normalizedQuery,
        states: startSearch(contexts),
        generation: searchRef.current.generation + 1,
      };
      await fillSearch(SEARCH_PAGE_SIZE, true);
    },
    [clearSearch, fillSearch],
  );

  /** The next page of results: reads on until a page more can be shown. */
  const loadingMoreRef = useRef(false);
  const loadMoreSearch = useCallback(async (): Promise<void> => {
    const { states } = searchRef.current;
    // One at a time: two rounds from the same cursors would read one page twice.
    if (!hasMore(states) || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      await fillSearch(visibleResults(states).length + SEARCH_PAGE_SIZE, false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [fillSearch]);

  /**
   * Add incoming messages (from websocket)
   * MessageStore handles deduplication of optimistic messages
   */
  const addIncoming = useCallback((newMessages: CurbMessage[]) => {
    if (newMessages.length > 0) {
      // Pass to VirtualizedChat - MessageStore handles deduplication
      setIncomingMessages(newMessages);
    }
  }, []);

  /**
   * Re-read one message the node says changed, and merge it into the open chat.
   *
   * Driven by `ReactionUpdated`, which names the message it changed. Going
   * straight to that message is what makes a reaction appear wherever it
   * lands: refreshing the newest page only works when the message happens to
   * be near the bottom, and reads as flakiness when it is not.
   *
   * `MessageStore.append` merges by id, so handing it one refreshed message is
   * an in-place update rather than an insert — the row keeps its position and
   * its React key, and only its reactions change.
   */
  const refreshReactedMessage = useCallback(
    async (contextId: string, messageId: string) => {
      try {
        const refreshed = await messageSync.refreshMessage(
          contextId,
          messageId,
          MESSAGE_PAGE_SIZE,
        );
        if (refreshed) {
          const [ui] = transformMessagesToUI([refreshed]);
          if (ui) setIncomingMessages([ui]);
          return;
        }

        // The id resolved to nothing: this session never loaded that message,
        // so there is no index to fetch it by. It can still be ON SCREEN —
        // scrolled back to in an earlier session, or painted from the store —
        // and scrolling will not repair it, because `loadOlder` only fetches
        // BEFORE what is displayed. Refresh the loaded window instead, bounded
        // by the oldest row the view is showing.
        const changed = await messageSync.refreshLoaded(
          contextId,
          oldestShownRef.current ?? 0,
        );
        if (changed.length > 0) setIncomingMessages(transformMessagesToUI(changed));
      } catch (error) {
        // The node is unreachable, so the reaction stays as it was. The next
        // open re-reads the window anyway; a failure here is a delay, not a
        // lost update.
        console.warn("refreshReactedMessage failed", error);
      }
    },
    [],
  );

  /**
   * Add optimistic message (for messages being sent)
   */
  const addOptimistic = useCallback((message: CurbMessage) => {
    // Add to ref immediately for local tracking
    messagesRef.current = [...messagesRef.current, message];
    // Set incomingMessages to trigger VirtualizedChat update
    // MessageStore will handle deduplication when real message arrives
    setIncomingMessages([message]);
  }, []);

  /**
   * Clear all messages (when switching chats)
   */
  const clear = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setIncomingMessages([]);
    setTotalCount(0);
    oldestShownRef.current = null;
    // No pagination position to reset: how far back a channel is loaded lives
    // in its stored cursor, which must survive switching away and back — that
    // is the whole point of keeping it.
    clearSearch();
  }, [clearSearch]);

  /**
   * Get current messages from ref (for immediate access)
   */
  const getCurrent = useCallback(() => {
    return messagesRef.current;
  }, []);

  return {
    messages,
    incomingMessages,
    totalCount,
    messagesRef,
    loadInitial,
    loadPrevious,
    openMessageLink,
    checkForNewMessages,
    addIncoming,
    refreshReactedMessage,
    addOptimistic,
    clear,
    getCurrent,
    searchResults,
    searchHasMore,
    searchQuery,
    isSearching,
    searchError,
    searchAllContexts,
    loadMoreSearch,
    clearSearch,
  };
}
