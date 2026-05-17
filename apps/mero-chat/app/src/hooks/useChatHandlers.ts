import { useCallback, useRef } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import type { ActiveChat } from "../types/Common";
import type { DMContextInfo } from "./useDMs";
import { getStoredSession } from "../utils/session";
import type { NotificationType } from "../utils/notificationSound";
import { log } from "../utils/logger";
import type {
  WebSocketEvent,
  ExecutionEventData,
} from "../types/WebSocketTypes";
import { getContextIdentity } from "@calimero-network/mero-react";
import { bytesParser } from "../utils/bytesParser";
import { getMessengerDisplayName } from "../utils/messengerName";

/**
 * Custom hook for handling chat-related events (messages, DMs, channels)
 * Extracted from Home component to reduce complexity
 */
// Simplified interface - accept refs directly instead of creating them internally
interface ChatHandlersRefs {
  mainMessages: React.MutableRefObject<{
    checkForNewMessages: (
      chat: ActiveChat,
      isDM: boolean,
      group: string,
      contextId: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addIncoming: (messages: any[]) => void;
  }>;
  threadMessages: React.MutableRefObject<{
    checkForNewThreadMessages: (
      chat: ActiveChat,
      parentMessageId: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      isMention?: boolean
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
      text: string
    ) => void
  >;
  notifyThread: React.MutableRefObject<
    (
      messageId: string,
      channelName: string,
      sender: string,
      text: string
    ) => void
  >;
  fetchDms: React.MutableRefObject<() => Promise<DMContextInfo[] | undefined>>;
  onDMSelected: React.MutableRefObject<
    (dm: DMContextInfo) => void
  >;
  fetchChannels: React.MutableRefObject<() => Promise<void>>;
  fetchDMs: React.MutableRefObject<() => Promise<void>>;
  fetchMembers: React.MutableRefObject<() => Promise<void>>;
  fetchGroupMembers: React.MutableRefObject<() => Promise<void>>;
  onLeftChannel: React.MutableRefObject<(contextId: string) => void>;
  subscribeToContext: React.MutableRefObject<(contextId: string) => void>;
  contextIdentityMap: React.MutableRefObject<Map<string, string>>;
  contextNameMap: React.MutableRefObject<Map<string, string>>;
  dmContextIds: React.MutableRefObject<Set<string>>;
  onUnreadRefresh: React.MutableRefObject<(contextId: string, contextIdentity: string) => Promise<void>>;
  onUnreadClear: React.MutableRefObject<(contextId: string, contextIdentity: string) => Promise<void>>;
}

export function useChatHandlers(
  activeChatRef: React.RefObject<ActiveChat | null>,
  activeChat: ActiveChat | null,
  refs: ChatHandlersRefs
) {
  // All callbacks come through refs - much simpler!

  // Track if we're already fetching messages to prevent concurrent calls
  const isFetchingMessagesRef = useRef(false);
  const isFetchingThreadMessagesRef = useRef(false);

  /**
   * Handle message updates from websocket events
   */
  const handleMessageUpdates = useCallback(
    async (
      useDM: boolean,
      group: string,
      contextId: string,
      shouldNotifyMessage: boolean
    ) => {
      if (!activeChatRef.current || !group) return;

      // group is private_dm
      // useDM is true
      // shouldNotify is false
      // with this combination it means we are getting
      // a reaction back meaning we should apply all new messages to the
      // active chat

      // Prevent concurrent message fetches
      if (isFetchingMessagesRef.current) return;

      try {
        isFetchingMessagesRef.current = true;
        const newMessages = await refs.mainMessages.current.checkForNewMessages(
          activeChatRef.current,
          useDM,
          group,
          contextId
        );

        if (newMessages.length > 0) {
          // Check if messages belong to the currently active chat
          const activeChatName = activeChatRef.current.name;
          const activeDMName = activeChatRef.current.username;
          const lastIndex = newMessages.length - 1;
          const lastMessageTest = newMessages[lastIndex];

          let messagesBelongToActiveChat = false;

          if (useDM) {
            if (!shouldNotifyMessage) {
              messagesBelongToActiveChat = true;
            } else if (contextId && activeChatRef.current?.contextId) {
              messagesBelongToActiveChat = contextId === activeChatRef.current.contextId;
            } else {
              messagesBelongToActiveChat =
                lastMessageTest.senderUsername === activeDMName;
            }
          } else {
            // Prefer contextId match (reliable) over channel name string comparison
            // which can silently mismatch when display name differs from event bytes
            if (contextId && activeChatRef.current?.contextId) {
              messagesBelongToActiveChat = contextId === activeChatRef.current.contextId;
            } else {
              messagesBelongToActiveChat = group === activeChatName;
            }
          }

          // Always show notifications for all messages (even if not in active chat)
          const lastMessage = newMessages[newMessages.length - 1];
          const currentUserId = getContextIdentity();

          if (!useDM) {
            const isFromCurrentUser = lastMessage.sender === currentUserId;

            // Show notification for ALL channel messages (not just active chat)
            if (
              !isFromCurrentUser &&
              lastMessage.senderUsername &&
              lastMessage.text
            ) {
              // Use message.group to show the correct channel name
              const channelName = lastMessage.group || activeChatName;
              if (shouldNotifyMessage) {
                refs.notifyChannel.current(
                  lastMessage.id,
                  channelName,
                  lastMessage.senderUsername,
                  lastMessage.text
                );
              }
            }
          } else {
            const currentDMIdentity = activeChatRef.current?.contextIdentity;
            const isFromCurrentUser =
              lastMessage &&
              (lastMessage.sender === currentUserId ||
                lastMessage.sender === currentDMIdentity);

            // Show notification for DM messages from other users
            if (
              !isFromCurrentUser &&
              lastMessage.senderUsername &&
              lastMessage.text
            ) {
              if (shouldNotifyMessage) {
                refs.notifyDM.current(
                  lastMessage.id,
                  lastMessage.senderUsername,
                  lastMessage.text
                );
              }
            }
          }

          // ONLY append messages if they belong to the active chat
          if (messagesBelongToActiveChat) {
            refs.mainMessages.current.addIncoming(newMessages);

            // Mark the channel as read and clear the badge whenever new messages
            // arrive while it's open. clearOne calls mark_as_read (the real WASM
            // function that get_unread_count reads from) and immediately zeroes
            // the React badge without waiting for a re-fetch.
            if (activeChatRef.current?.contextId && activeChatRef.current?.contextIdentity) {
              void refs.onUnreadClear.current(
                activeChatRef.current.contextId,
                activeChatRef.current.contextIdentity,
              );
            }
          }
        }
      } catch (error) {
        log.error("ChatHandlers", "Error handling message updates", error);
      } finally {
        isFetchingMessagesRef.current = false;
      }
    },
    [activeChatRef, activeChat, refs]
  );

  /**
   * Handle thread message updates from websocket events
   */
  const handleThreadMessageUpdates = useCallback(
    async (useDM: boolean, parentMessageId: string) => {
      if (!activeChatRef.current || !parentMessageId) {
        log.debug(
          "ChatHandlers",
          "Skipping thread message check - no active chat or parent message ID"
        );
        return;
      }

      // Prevent concurrent message fetches
      if (isFetchingThreadMessagesRef.current) {
        log.debug(
          "ChatHandlers",
          "Skipping thread message check - already fetching thread messages"
        );
        return;
      }

      // Removed throttling to allow real-time thread message updates

      try {
        isFetchingThreadMessagesRef.current = true;
        log.debug(
          "ChatHandlers",
          `Checking for new thread messages for parent: ${parentMessageId}`
        );

        const newThreadMessages =
          await refs.threadMessages.current.checkForNewThreadMessages(
            activeChatRef.current,
            parentMessageId
          );

        if (newThreadMessages.length > 0) {
          log.debug(
            "ChatHandlers",
            `Found ${newThreadMessages.length} new thread messages`
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
    [refs]
  );

  /**
   * Handle a MessageSent event for a context that is NOT the active chat.
   * Fetches the last message (for toast content), shows the notification, and
   * refreshes the per-context unread counts from WASM.
   */
  const handleBackgroundMessage = useCallback(
    async (contextId: string, isDM: boolean, messageGroup: string) => {
      const contextIdentity = refs.contextIdentityMap.current.get(contextId);
      if (!contextIdentity) return;

      try {
        const api = new ClientApiDataSource();
        // Use dmContextIds as the authoritative source for DM classification.
        // Bytes-parse failures leave isDM = false even for real DMs.
        const isDMContext = isDM || refs.dmContextIds.current.has(contextId);
        const resp = await api.getMessages({
          group: { name: isDMContext ? "private_dm" : (messageGroup || "") },
          limit: 1,
          offset: 0,
          is_dm: isDMContext,
          dm_identity: isDMContext ? contextIdentity : undefined,
          refetch_context_id: contextId,
          refetch_identity: contextIdentity,
        });

        const msgs = resp.data?.messages;
        if (msgs && msgs.length > 0) {
          const msg = msgs[msgs.length - 1];
          // msg.sender is the sender's identity in this context.
          // contextIdentity is our identity in this context.
          // Also skip messages the current user sent from their display name
          // (secondary check via messengerDisplayName for old-style DMs).
          const isMine =
            msg.sender === contextIdentity ||
            msg.sender_username === getMessengerDisplayName();

          if (!isMine && msg.text && !msg.deleted) {
            if (isDMContext) {
              refs.notifyDM.current(msg.id, msg.sender_username, msg.text);
            } else {
              const contextName =
                refs.contextNameMap.current.get(contextId) ?? messageGroup;
              refs.notifyChannel.current(
                msg.id,
                contextName,
                msg.sender_username,
                msg.text,
              );
            }
            refs.playSoundForMessage.current(
              msg.id,
              isDMContext ? "dm" : "channel",
              false,
            );
          }
        }
      } catch (e) {
        log.debug("ChatHandlers", "Background message fetch failed", e);
      }

      // Always refresh unread counts even if the fetch above failed.
      await refs.onUnreadRefresh.current(contextId, contextIdentity);
    },
    [refs],
  );

  /**
   * Handle a MessageSentThread event for a context that is NOT the active chat.
   * Fetches the last main message to identify the sender, shows a thread-reply
   * notification, and refreshes the per-context unread counts.
   */
  const handleBackgroundThreadMessage = useCallback(
    async (contextId: string, isDM: boolean, messageGroup: string) => {
      const contextIdentity = refs.contextIdentityMap.current.get(contextId);
      if (!contextIdentity) return;

      try {
        const api = new ClientApiDataSource();
        // Fetch the most recent message to get sender info. We can't fetch
        // the specific thread reply without the parent ID, so we use the
        // latest message as a proxy for the sender's name.
        const resp = await api.getMessages({
          group: { name: isDM ? "private_dm" : (messageGroup || "") },
          limit: 1,
          offset: 0,
          is_dm: isDM,
          dm_identity: isDM ? contextIdentity : undefined,
          refetch_context_id: contextId,
          refetch_identity: contextIdentity,
        });

        const msgs = resp.data?.messages;
        const msg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const isMine =
          msg &&
          (msg.sender === contextIdentity ||
            msg.sender_username === getMessengerDisplayName());

        if (!isMine) {
          const contextName =
            refs.contextNameMap.current.get(contextId) ?? messageGroup;
          const sender = msg?.sender_username ?? "Someone";
          const text = msg?.text ?? "";
          const msgId = msg?.id ?? `thread-${Date.now()}`;
          refs.notifyThread.current(msgId, contextName, sender, text);
        }
      } catch (e) {
        log.debug("ChatHandlers", "Background thread message fetch failed", e);
      }

      await refs.onUnreadRefresh.current(contextId, contextIdentity);
    },
    [refs],
  );

  /**
   * Handle DM-specific updates (group-based DMs are just contexts)
   */
  const handleDMUpdates = useCallback(
    async (_sessionChat: ActiveChat | null) => {
      try {
        await refs.fetchDms.current();
      } catch (error) {
        log.error("ChatHandlers", "Error handling DM updates", error);
      }
    },
    [refs]
  );

  /**
   * Handle execution events inside StateMutation
   * Map each event type to its specific data refresh action
   */
  const handleExecutionEvents = useCallback(
    (contextId: string, executionEvents: ExecutionEventData[]) => {
      // Track which specific actions we need to take
      const actions = {
        fetchMessages: false,
        fetchMessageGroup: "",
        shouldNotifyMessage: true,
        isThreadEvent: false,
        isDM: false,
        fetchChannels: false,
        fetchDMs: false,
        dmDeleted: false,
        fetchMembers: false,
      };

      for (const executionEvent of executionEvents) {
        switch (executionEvent.kind) {
          case "MessageSent":
            actions.fetchMessages = true;
            // Convert bytes to ASCII and extract channel/group
            if (executionEvent.data) {
              try {
                const asciiString = bytesParser(executionEvent.data);
                const parsed = JSON.parse(asciiString);
                if (parsed.channel) {
                  actions.fetchMessageGroup = parsed.channel;
                  actions.isDM = parsed.channel === "private_dm";
                }
              } catch (e) {
                log.warn("ChatHandlers", "Couldn't decode MessageSent data", e);
              }
            }
            break;
          case "MessageSentThread":
            actions.fetchMessages = true;
            actions.isThreadEvent = true;
            actions.shouldNotifyMessage = false;
            // Convert bytes to ASCII and extract channel/group
            if (executionEvent.data) {
              try {
                const asciiString = bytesParser(executionEvent.data);

                // Parse the JSON to get channel/group and message_id
                const parsed = JSON.parse(asciiString);
                if (parsed.channel) {
                  actions.fetchMessageGroup = parsed.channel;
                  actions.isDM = parsed.channel === "private_dm";
                }
              } catch (e) {
                log.warn("ChatHandlers", "Couldn't decode MessageSentThread data", e);
              }
            }
            break;
          case "MessageReceived":
            // Fetch new messages for current chat
            actions.fetchMessages = true;
            break;

          case "ReactionUpdated": {
            // Fetch messages to get updated reactions
            const currentChat = activeChatRef.current;

            if (currentChat) {
              actions.isDM = currentChat.type === "direct_message";
              if (currentChat.type === "channel") {
                actions.fetchMessageGroup = currentChat.name;
              } else {
                actions.fetchMessageGroup = "private_dm";
              }
            }
            actions.shouldNotifyMessage = false;
            actions.fetchMessages = true;
            break;
          }

          case "ChannelCreated":
            // Refresh channel list only
            actions.fetchChannels = true;
            break;

          case "ChannelJoined":
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            if (executionEvent.data) {
              try {
                const parsed = JSON.parse(bytesParser(executionEvent.data));
                if (parsed.context_id) refs.subscribeToContext.current(parsed.context_id);
              } catch { /* ignore parse errors */ }
            }
            log.debug("ChatHandlers", "Channel joined, refreshing channel list and members");
            break;

          case "ChannelLeft":
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            if (contextId === activeChatRef.current?.contextId) {
              refs.onLeftChannel.current(contextId);
            }
            log.debug("ChatHandlers", "Channel left, refreshing channel list and members");
            break;

          case "ChannelInvited":
            actions.fetchChannels = true;
            actions.fetchMembers = true;
            if (executionEvent.data) {
              try {
                const parsed = JSON.parse(bytesParser(executionEvent.data));
                if (parsed.context_id) refs.subscribeToContext.current(parsed.context_id);
              } catch { /* ignore parse errors */ }
            }
            log.debug("ChatHandlers", "User invited to channel, refreshing channel list and members");
            break;

          case "ChatJoined":
            actions.fetchMembers = true;
            refs.fetchGroupMembers.current();
            break;

          case "DMCreated":
            actions.fetchDMs = true;
            if (executionEvent.data) {
              try {
                const parsed = JSON.parse(bytesParser(executionEvent.data));
                if (parsed.context_id) refs.subscribeToContext.current(parsed.context_id);
              } catch { /* ignore parse errors */ }
            }
            log.debug("ChatHandlers", "DM created, refreshing DM list");
            break;
          case "DMDeleted":
            actions.fetchDMs = true;
            actions.dmDeleted = true;
            log.debug("ChatHandlers", "DM deleted, refreshing DM list");
            break;

          case "InvitationAccepted":
            // Refresh DM list and potentially trigger DM selection
            actions.fetchDMs = true;
            log.debug(
              "ChatHandlers",
              "Invitation accepted, refreshing DM list"
            );
            break;

          case "NewIdentityUpdated":
          case "InvitationPayloadUpdated":
            // Refresh DM list to update metadata and trigger state updates
            actions.fetchDMs = true;
            log.debug(
              "ChatHandlers",
              "DM metadata updated, refreshing DM list"
            );
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
        let messageGroup = actions.fetchMessageGroup;
        let isDM = actions.isDM;

        const isActiveContext = contextId === activeChatRef.current?.contextId;

        // Only fall back to the active chat's name/type when the event belongs to
        // the active context. Applying this fallback to background contexts would
        // misidentify a DM whose bytes couldn't be parsed as the current channel,
        // causing the notification to read "Sender in #ChannelName" instead of
        // "New DM from Sender".
        if (!messageGroup && isActiveContext && activeChatRef.current) {
          if (activeChatRef.current.type === "channel") {
            messageGroup = activeChatRef.current.name;
            isDM = false;
          } else if (activeChatRef.current.type === "direct_message") {
            messageGroup = "private_dm";
            isDM = true;
          }
        }
        if (isActiveContext) {
          // Active chat: use existing flow (fetch, deduplicate, append, notify)
          handleMessageUpdates(isDM, messageGroup, contextId, actions.shouldNotifyMessage);
        } else if (actions.shouldNotifyMessage) {
          // Background context with notification: lightweight fetch + toast + unread refresh
          void handleBackgroundMessage(contextId, isDM, messageGroup);
        } else if (actions.isThreadEvent) {
          // Background thread reply: show thread notification + unread refresh
          void handleBackgroundThreadMessage(contextId, isDM, messageGroup);
        } else {
          // Background context, no notification (e.g. reaction from another context)
          // Just refresh unread count so badge stays accurate.
          const bgIdentity = refs.contextIdentityMap.current.get(contextId);
          if (bgIdentity) void refs.onUnreadRefresh.current(contextId, bgIdentity);
        }
      }
      if (actions.fetchChannels) {
        refs.fetchChannels.current();
      }
      if (actions.fetchDMs) {
        refs.fetchDMs.current();
        const sessionChat = getStoredSession();
        if (sessionChat?.type === "direct_message") {
          setTimeout(async () => {
            try {
              const updated = await refs.fetchDms.current();
              const stillExists = updated?.some(
                (dm) => dm.contextId === sessionChat.contextId
              );
              if (!stillExists && updated && updated.length > 0) {
                refs.onDMSelected.current(updated[0]);
              } else if (!actions.dmDeleted) {
                handleDMUpdates(sessionChat);
              }
            } catch (e) {
              log.error("ChatHandlers", "Error handling DM update", e);
            }
          }, 150);
        }
      }
      if (actions.fetchMembers) {
        // Always fetch members for channels, and for DMs when appropriate
        if (!actions.isDM) {
          refs.fetchMembers.current();
        }
        // For DMs, we might need to refresh DM data to get updated member info
        if (actions.isDM && actions.fetchDMs) {
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
    [handleMessageUpdates, handleBackgroundMessage, handleBackgroundThreadMessage, refs]
  );

  /**
   * Handle state mutation events (most common websocket event)
   * StateMutation contains an array of execution events in event.data.events
   * Each event type triggers only the specific data refresh it needs
   */
  const handleStateMutation = useCallback(
    async (event: WebSocketEvent) => {
      if (event.data?.events && event.data.events.length > 0) {
        log.info("useChatHandlers", `[SSE] handleStateMutation contextId=${event.contextId} events=${event.data.events.length}`, event.data.events);
        handleExecutionEvents(event.contextId, event.data.events);
      }
    },
    [handleExecutionEvents]
  );

  return {
    handleMessageUpdates,
    handleBackgroundMessage,
    handleThreadMessageUpdates,
    handleDMUpdates,
    handleStateMutation,
    handleExecutionEvents,
  };
}
