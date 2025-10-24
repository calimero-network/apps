import { useCallback, useRef } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ActiveChat } from "../types/Common";
import type { DMChatInfo } from "../api/clientApi";
import { getStoredSession } from "../utils/session";
import type { NotificationType } from "../utils/notificationSound";
import { log } from "../utils/logger";
import type {
  WebSocketEvent,
  ExecutionEventData,
} from "../types/WebSocketTypes";
import { getExecutorPublicKey } from "@calimero-network/calimero-client";

/**
 * Custom hook for handling chat-related events (messages, DMs, channels)
 * Extracted from Home component to reduce complexity
 */
// Simplified interface - accept refs directly instead of creating them internally
interface ChatHandlersRefs {
  mainMessages: React.MutableRefObject<{
    checkForNewMessages: (chat: ActiveChat, isDM: boolean) => Promise<any[]>;
    addIncoming: (messages: any[]) => void;
  }>;
  threadMessages: React.MutableRefObject<{
    checkForNewThreadMessages: (
      chat: ActiveChat,
      parentMessageId: string,
    ) => Promise<any[]>;
    addIncoming: (messages: any[]) => void;
  }>;
  playSoundForMessage: React.MutableRefObject<
    (messageId: string, type?: NotificationType, isMention?: boolean) => void
  >;
  notifyMessage: React.MutableRefObject<
    (
      messageId: string,
      sender: string,
      text: string,
      isMention?: boolean,
    ) => void
  >;
  notifyDM: React.MutableRefObject<
    (messageId: string, sender: string, text: string) => void
  >;
  notifyChannel: React.MutableRefObject<
    (
      messageId: string,
      channelName: string,
      sender: string,
      text: string,
    ) => void
  >;
  fetchDms: React.MutableRefObject<() => Promise<DMChatInfo[] | undefined>>;
  onDMSelected: React.MutableRefObject<
    (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void
  >;
  fetchChannels: React.MutableRefObject<() => Promise<void>>;
  fetchDMs: React.MutableRefObject<() => Promise<void>>;
  fetchMembers: React.MutableRefObject<() => Promise<void>>;
}

export function useChatHandlers(
  activeChatRef: React.RefObject<ActiveChat | null>,
  activeChat: ActiveChat | null,
  refs: ChatHandlersRefs,
) {
  // All callbacks come through refs - much simpler!

  // Track if we're already fetching messages to prevent concurrent calls
  const isFetchingMessagesRef = useRef(false);
  const isFetchingThreadMessagesRef = useRef(false);
  const lastMessageCheckRef = useRef<number>(0);
  const lastThreadMessageCheckRef = useRef<number>(0);
  const lastReadMessageRef = useRef<{ chatId: string; timestamp: number }>({
    chatId: "",
    timestamp: 0,
  });

  /**
   * Handle message updates from websocket events
   */
  const handleMessageUpdates = useCallback(
    async (useDM: boolean) => {
      if (!activeChatRef.current) return;

      // Prevent concurrent message fetches
      if (isFetchingMessagesRef.current) return;

      // Aggressive throttle to 5 seconds to prevent API hammering
      const now = Date.now();
      if (now - lastMessageCheckRef.current < 5000) {
        log.debug("ChatHandlers", "Skipping message check - throttled");
        return;
      }
      lastMessageCheckRef.current = now;

      try {
        isFetchingMessagesRef.current = true;

        const newMessages = await refs.mainMessages.current.checkForNewMessages(
          activeChatRef.current,
          useDM,
        );

        if (newMessages.length > 0) {
          refs.mainMessages.current.addIncoming(newMessages);

          const chatId = activeChatRef.current.id || activeChatRef.current.name;
          const shouldMarkAsRead =
            lastReadMessageRef.current.chatId !== chatId ||
            now - lastReadMessageRef.current.timestamp > 2000;

          if (shouldMarkAsRead) {
            lastReadMessageRef.current = { chatId, timestamp: now };

            if (activeChat?.type === "channel") {
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage?.timestamp) {
                new ClientApiDataSource()
                  .readMessage({
                    channel: { name: activeChat?.name },
                    timestamp: lastMessage.timestamp,
                  })
                  .then(() => {
                    refs.fetchChannels.current();
                  })
                  .catch((error) =>
                    log.error(
                      "ChatHandlers",
                      "Failed to mark message as read",
                      error,
                    ),
                  );
              }
              // Only trigger notifications and sounds for messages from other users
              // AND when we're viewing the active chat (not from background channels)
              const currentUserId = getExecutorPublicKey();
              const isFromCurrentUser = lastMessage.sender === currentUserId;
              
              // Check if this message is in the currently visible/active channel
              const isActiveChannel = activeChat && activeChatRef.current && 
                                      activeChat.name === activeChatRef.current.name;

              if (!isFromCurrentUser && isActiveChannel) {
                // Play sound and show notification only for the active channel
                refs.playSoundForMessage.current(
                  lastMessage.id,
                  "message",
                  false,
                );
                // Note: With multi-context subscription, we only handle the active channel here
                // Background channel notifications would require fetching all channels
                if (lastMessage.senderUsername && lastMessage.text && activeChatRef.current) {
                  refs.notifyChannel.current(
                    lastMessage.id,
                    activeChatRef.current.name,
                    lastMessage.senderUsername,
                    lastMessage.text,
                  );
                }
              }
            } else {
              const lastMessage = newMessages[newMessages.length - 1];
              new ClientApiDataSource()
                .readDm({
                  other_user_id: activeChatRef.current?.name || "",
                })
                .then(() => {
                  refs.fetchDMs.current();
                })
                .catch((error) =>
                  log.error("ChatHandlers", "Failed to mark DM as read", error),
                );

              // Only trigger notifications for messages from other users
              // For DMs, check both the main identity and the DM-specific identity
              const currentUserId = getExecutorPublicKey();
              const currentDMIdentity = activeChatRef.current?.account;
              const isFromCurrentUser =
                lastMessage &&
                (lastMessage.sender === currentUserId ||
                  lastMessage.sender === currentDMIdentity);

              // Trigger notification for DM
              if (
                !isFromCurrentUser &&
                lastMessage &&
                lastMessage.senderUsername &&
                lastMessage.text
              ) {
                refs.notifyDM.current(
                  lastMessage.id,
                  lastMessage.senderUsername,
                  lastMessage.text,
                );
              }
            }
          }
        }
      } catch (error) {
        log.error("ChatHandlers", "Error handling message updates", error);
      } finally {
        isFetchingMessagesRef.current = false;
      }
    },
    [activeChatRef, activeChat, refs],
  );

  /**
   * Handle thread message updates from websocket events
   */
  const handleThreadMessageUpdates = useCallback(
    async (useDM: boolean, parentMessageId: string) => {
      if (!activeChatRef.current || !parentMessageId) {
        log.debug(
          "ChatHandlers",
          "Skipping thread message check - no active chat or parent message ID",
        );
        return;
      }

      // Prevent concurrent message fetches
      if (isFetchingThreadMessagesRef.current) {
        log.debug(
          "ChatHandlers",
          "Skipping thread message check - already fetching thread messages",
        );
        return;
      }

      // Aggressive throttle to 5 seconds to prevent API hammering
      const now = Date.now();
      if (now - lastThreadMessageCheckRef.current < 5000) {
        log.debug("ChatHandlers", "Skipping thread message check - throttled");
        return;
      }
      lastThreadMessageCheckRef.current = now;

      try {
        isFetchingThreadMessagesRef.current = true;
        log.debug(
          "ChatHandlers",
          `Checking for new thread messages for parent: ${parentMessageId}`,
        );

        const newThreadMessages =
          await refs.threadMessages.current.checkForNewThreadMessages(
            activeChatRef.current,
            parentMessageId,
          );

        if (newThreadMessages.length > 0) {
          log.debug(
            "ChatHandlers",
            `Found ${newThreadMessages.length} new thread messages`,
          );
          refs.threadMessages.current.addIncoming(newThreadMessages);
        } else {
          log.debug("ChatHandlers", "No new thread messages found");
        }
      } catch (error) {
        log.error("ChatHandlers", "Error fetching thread messages", error);
      } finally {
        isFetchingThreadMessagesRef.current = false;
      }
    },
    [refs],
  );

  // Track last DM update to prevent infinite loops
  const lastDMUpdateRef = useRef<{
    contextId: string;
    timestamp: number;
  } | null>(null);

  /**
   * Handle DM-specific updates
   */
  const handleDMUpdates = useCallback(
    async (sessionChat: ActiveChat | null) => {
      if (sessionChat?.type !== "direct_message") return;

      const now = Date.now();
      if (
        lastDMUpdateRef.current &&
        lastDMUpdateRef.current.contextId === sessionChat.contextId &&
        now - lastDMUpdateRef.current.timestamp < 2000
      ) {
        return;
      }

      try {
        const updatedDMs = await refs.fetchDms.current();

        if (
          !sessionChat?.isFinal &&
          updatedDMs?.length &&
          (sessionChat?.canJoin ||
            !sessionChat?.isSynced ||
            !sessionChat?.account ||
            !sessionChat?.otherIdentityNew)
        ) {
          const currentDM = updatedDMs.find(
            (dm) => dm.context_id === sessionChat.contextId,
          );

          if (currentDM && sessionChat.contextId) {
            lastDMUpdateRef.current = {
              contextId: sessionChat.contextId,
              timestamp: now,
            };
            refs.onDMSelected.current(currentDM, undefined, false);
          }
        }
      } catch (error) {
        log.error("ChatHandlers", "Error handling DM updates", error);
      }
    },
    [refs],
  );

  /**
   * Handle execution events inside StateMutation
   * Map each event type to its specific data refresh action
   */
  const handleExecutionEvents = useCallback(
    (executionEvents: ExecutionEventData[], useDM: boolean) => {
      // Track which specific actions we need to take
      const actions = {
        fetchMessages: false,
        fetchChannels: false,
        fetchDMs: false,
        fetchMembers: false,
      };

      // Log events for debugging
      if (executionEvents.length > 0) {
        log.debug("ChatHandlers", "Processing events:", executionEvents.map(e => e.kind));
      }

      for (const executionEvent of executionEvents) {
        switch (executionEvent.kind) {
          case "MessageSent":
          case "MessageReceived":
            // Fetch new messages for current chat
            actions.fetchMessages = true;
            break;

          case "ReactionUpdated":
            // Fetch messages to get updated reactions
            actions.fetchMessages = true;
            break;

          case "ChannelCreated":
            // Refresh channel list only
            actions.fetchChannels = true;
            break;

          case "ChannelJoined":
            // Refresh channel list and members
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            log.debug("ChatHandlers", "Channel joined, refreshing channel list and members");
            break;

          case "ChannelLeft":
            // Refresh channel list and members
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            log.debug("ChatHandlers", "Channel left, refreshing channel list and members");
            break;

          case "ChannelInvited":
            // Refresh channel list and members
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            log.debug("ChatHandlers", "User invited to channel, refreshing channel list and members");
            break;

          case "ChatJoined":
            // When a new user joins the chat, refresh members list
            actions.fetchMembers = true;
            break;

          case "DMCreated":
            // Refresh DM list and potentially trigger DM selection
            actions.fetchDMs = true;
            log.debug("ChatHandlers", "DM created, refreshing DM list");
            break;

          case "InvitationAccepted":
            // Refresh DM list and potentially trigger DM selection
            actions.fetchDMs = true;
            log.debug("ChatHandlers", "Invitation accepted, refreshing DM list");
            break;

          case "NewIdentityUpdated":
          case "InvitationPayloadUpdated":
            // Refresh DM list to update metadata
            actions.fetchDMs = true;
            log.debug("ChatHandlers", "DM metadata updated, refreshing DM list");
            break;

          case "ChatInitialized":
            // Full refresh on initialization
            actions.fetchChannels = true;
            actions.fetchDMs = true;
            actions.fetchMembers = true;
            break;
        }
      }

      // Execute only the necessary actions with proper sequencing
      if (actions.fetchMessages) {
        handleMessageUpdates(useDM);
      }
      if (actions.fetchChannels) {
        refs.fetchChannels.current();
      }
      if (actions.fetchDMs) {
        refs.fetchDMs.current();
      }
      if (actions.fetchMembers) {
        // Always fetch members for channels, and for DMs when appropriate
        if (!useDM) {
          refs.fetchMembers.current();
        }
        // For DMs, we might need to refresh DM data to get updated member info
        if (useDM && actions.fetchDMs) {
          // DM member updates are handled through DM list refresh
          refs.fetchDMs.current();
        }
      }

      // Log what actions were taken for debugging
      const takenActions = Object.entries(actions)
        .filter(([_, value]) => value)
        .map(([key, _]) => key);
      if (takenActions.length > 0) {
        log.debug("ChatHandlers", "Executing actions:", takenActions);
      }
    },
    [handleMessageUpdates, refs],
  );

  /**
   * Handle state mutation events (most common websocket event)
   * StateMutation contains an array of execution events in event.data.events
   * Each event type triggers only the specific data refresh it needs
   */
  const handleStateMutation = useCallback(
    async (event: WebSocketEvent) => {
      const sessionChat = getStoredSession();
      const useDM = (sessionChat?.type === "direct_message" &&
        sessionChat?.account &&
        !sessionChat?.canJoin &&
        sessionChat?.otherIdentityNew) as boolean;

      // Process execution events if present - this handles all the specific refreshes
      if (event.data?.events && event.data.events.length > 0) {
        handleExecutionEvents(event.data.events, useDM);
      }
    },
    [handleExecutionEvents],
  );

  return {
    handleMessageUpdates,
    handleThreadMessageUpdates,
    handleDMUpdates,
    handleStateMutation,
    handleExecutionEvents,
  };
}
