import { useState, useRef, useCallback, useEffect } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { FullMessageResponse } from "../api/clientApi";
import type { ActiveChat, CurbMessage, ChatMessagesData, ChatMessagesDataWithOlder } from "../types/Common";
import { transformMessageToUI, transformMessagesToUI } from "../utils/messageTransformers";
import { MESSAGE_PAGE_SIZE, RECENT_MESSAGES_CHECK_SIZE } from "../constants/app";
import { log } from "../utils/logger";
import { parseErrorMessage } from "../utils/errorParser";

/**
 * Custom hook for managing thread messages
 * Similar to useMessages but for message threads
 */
export function useThreadMessages() {
  const [messages, setMessages] = useState<CurbMessage[]>([]);
  const [incomingMessages, setIncomingMessages] = useState<CurbMessage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(MESSAGE_PAGE_SIZE);
  const messagesRef = useRef<CurbMessage[]>([]);
  const lastCheckRef = useRef<number>(0);
  const lastThreadCheckRef = useRef<number>(0);
  
  // Debug logging for state changes
  useEffect(() => {
    log.debug('useThreadMessages', `messages state changed, length: ${messages.length}`);
  }, [messages]);
  
  useEffect(() => {
    log.debug('useThreadMessages', `incomingMessages state changed, length: ${incomingMessages.length}`, incomingMessages);
  }, [incomingMessages]);

  /**
   * Load initial thread messages
   */
  const loadInitial = useCallback(async (
    activeChat: ActiveChat | null,
    parentMessageId: string
  ): Promise<ChatMessagesData> => {
    log.debug('useThreadMessages', `loadInitial called for parent: ${parentMessageId}`);
    if (!activeChat?.name) {
      log.debug('useThreadMessages', 'No active chat name, returning empty');
      return {
        messages: [],
        totalCount: 0,
        hasMore: false,
      };
    }

    const isDM = activeChat.type === "direct_message";
    const groupName = isDM ? "private_dm" : (activeChat.name || "");
    
    log.debug('useThreadMessages', `Calling API with params:`, {
      group: groupName,
      parent_message: parentMessageId,
      is_dm: isDM,
      dm_identity: activeChat.account
    });
    
    const response: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: groupName },
        limit: MESSAGE_PAGE_SIZE,
        offset: 0,
        parent_message: parentMessageId,
        is_dm: isDM,
        dm_identity: activeChat.account,
      });

    log.debug('useThreadMessages', `API response:`, response);
    
    if (response.error) {
      const parsedError = parseErrorMessage(response.error.message);
      log.error('useThreadMessages', `API returned error:`, response.error);
      log.error('useThreadMessages', `Parsed error message: ${parsedError}`);
    }

    if (response.data) {
      const messagesArray = transformMessagesToUI(response.data.messages);
      log.debug('useThreadMessages', `loadInitial loaded ${messagesArray.length} messages`);
      messagesRef.current = messagesArray;
      setMessages(messagesArray);
      setTotalCount(response.data.total_count);
      setOffset(MESSAGE_PAGE_SIZE);

      return {
        messages: messagesArray,
        totalCount: response.data.total_count,
        hasMore: response.data.start_position < response.data.total_count,
      };
    }

    log.debug('useThreadMessages', 'No response data, returning empty');
    return {
      messages: [],
      totalCount: 0,
      hasMore: false,
    };
  }, []);

  /**
   * Load previous (older) thread messages
   */
  const loadPrevious = useCallback(async (
    activeChat: ActiveChat | null,
    parentMessageId: string
  ): Promise<ChatMessagesDataWithOlder> => {
    if (!activeChat || offset >= totalCount) {
      return {
        messages: [],
        totalCount,
        hasOlder: false,
      };
    }

    const isDM = activeChat.type === "direct_message";
    const groupName = isDM ? "private_dm" : (activeChat.name || "");
    
    const response: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: groupName },
        limit: MESSAGE_PAGE_SIZE,
        offset,
        parent_message: parentMessageId,
        is_dm: isDM,
        dm_identity: activeChat.account,
      });

    if (response.data) {
      const messagesArray = transformMessagesToUI(response.data.messages);
      setOffset(offset + MESSAGE_PAGE_SIZE);

      return {
        messages: messagesArray,
        totalCount: response.data.total_count,
        hasOlder: response.data.start_position < response.data.total_count,
      };
    }

    return {
      messages: [],
      totalCount: 0,
      hasOlder: false,
    };
  }, [offset, totalCount]);

  /**
   * Add optimistic message (for messages being sent)
   */
  const addOptimistic = useCallback((message: CurbMessage) => {
    log.debug('useThreadMessages', `addOptimistic called for message:`, message);
    const newMessages = [...messagesRef.current, message];
    messagesRef.current = newMessages;
    setMessages(newMessages);
    // Also add to incomingMessages for VirtualizedChat to display
    setIncomingMessages(prev => [...prev, message]);
    log.debug('useThreadMessages', `Total thread messages after optimistic add: ${newMessages.length}`);
  }, []);

  /**
   * Check for and add new thread messages from websocket events
   */
  const checkForNewThreadMessages = useCallback(async (
    activeChat: ActiveChat | null,
    parentMessageId: string
  ): Promise<CurbMessage[]> => {
    if (!activeChat || !parentMessageId) {
      log.debug('useThreadMessages', 'Skipping thread message check - no active chat or parent message ID');
      return [];
    }

    // Aggressive throttling: only check once every 3 seconds per thread
    const now = Date.now();
    if (now - lastThreadCheckRef.current < 3000) {
      log.debug('useThreadMessages', 'Skipping thread message check - throttled');
      return [];
    }
    lastThreadCheckRef.current = now;

    const isDM = activeChat.type === "direct_message";
    const groupName = isDM ? "private_dm" : (activeChat.name || "");
    
    log.debug('useThreadMessages', `Fetching thread messages for parent: ${parentMessageId}`);
    const response: ResponseData<FullMessageResponse> =
      await new ClientApiDataSource().getMessages({
        group: { name: groupName },
        limit: RECENT_MESSAGES_CHECK_SIZE,
        offset: 0,
        parent_message: parentMessageId,
        is_dm: isDM,
        dm_identity: activeChat.account,
      });

    if (!response.data) {
      log.debug('useThreadMessages', 'No response data from API');
      return [];
    }

    // Transform messages - MessageStore will handle deduplication
    const newMessages = response.data.messages.map((msg) => transformMessageToUI(msg));

    if (newMessages.length > 0) {
      log.debug('useThreadMessages', `Found ${newMessages.length} new thread messages`);
      // Only update ref, not state (MessageStore will deduplicate in VirtualizedChat)
      messagesRef.current = [...messagesRef.current, ...newMessages];
      return newMessages;
    }

    log.debug('useThreadMessages', 'No new thread messages found');
    return [];
  }, []);

  /**
   * Add incoming messages (from websocket)
   */
  const addIncoming = useCallback((newMessages: CurbMessage[]) => {
    log.debug('useThreadMessages', `addIncoming called with ${newMessages.length} messages`);
    if (newMessages.length > 0) {
      log.debug('useThreadMessages', `Setting incoming messages:`, newMessages);
      setIncomingMessages(newMessages);
    }
  }, []);

  /**
   * Clear thread messages
   */
  const clear = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setIncomingMessages([]);
    setTotalCount(0);
    setOffset(MESSAGE_PAGE_SIZE);
  }, []);

  return {
    messages,
    incomingMessages,
    totalCount,
    messagesRef,
    loadInitial,
    loadPrevious,
    addOptimistic,
    addIncoming,
    checkForNewThreadMessages,
    clear,
  };
}

