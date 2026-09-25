import { useEffect, useRef } from "react";
import MessageStore from "../MessageStore";
import type { UpdateDescriptor } from "../MessageStore";

interface Message {
  id: string;
  timestamp: number;
}

interface UseMessageUpdatesProps<T extends Message> {
  incomingMessages: T[];
  updatedMessages: { id: string; descriptor: UpdateDescriptor<T> }[];
  store: MessageStore<T>;
  isAtBottom: boolean;
  shouldTriggerNewItemIndicator?: (item: T) => boolean;
  onMessagesUpdated: (messages: T[], addedCount: number) => void;
  onNewMessagesWhileNotAtBottom: () => void;
  onOwnMessageSent?: () => void; // Called when user sends their own message
}

export function useMessageUpdates<T extends Message>({
  incomingMessages,
  updatedMessages,
  store,
  isAtBottom,
  shouldTriggerNewItemIndicator,
  onMessagesUpdated,
  onNewMessagesWhileNotAtBottom,
  onOwnMessageSent,
}: UseMessageUpdatesProps<T>): void {
  // Use refs to avoid adding callbacks to dependency arrays (prevents render loops)
  const onMessagesUpdatedRef = useRef(onMessagesUpdated);
  const onNewMessagesWhileNotAtBottomRef = useRef(
    onNewMessagesWhileNotAtBottom,
  );
  const onOwnMessageSentRef = useRef(onOwnMessageSent);

  // Keep refs updated
  useEffect(() => {
    onMessagesUpdatedRef.current = onMessagesUpdated;
    onNewMessagesWhileNotAtBottomRef.current = onNewMessagesWhileNotAtBottom;
    onOwnMessageSentRef.current = onOwnMessageSent;
  });

  // Handle incoming messages
  // Following VirtuosoMessageList pattern: distinguish between appending new messages vs updating existing
  // Reference: https://virtuoso.dev/virtuoso-message-list/tutorial/loading-older-messages/
  useEffect(() => {
    if (incomingMessages.length === 0) return;

    const { addedCount, updatedCount } = store.append(incomingMessages);

    if (addedCount > 0 || updatedCount > 0) {
      onMessagesUpdatedRef.current([...store.messages], addedCount);

      // Pattern from VirtuosoMessageList: distinguish between sent vs received messages
      // Check ANY new incoming message, not just added ones (handles optimistic -> real transition)
      if (incomingMessages.length > 0) {
        // Check the last incoming message
        const lastIncomingMessage =
          incomingMessages[incomingMessages.length - 1];
        const shouldTriggerIndicator = shouldTriggerNewItemIndicator
          ? shouldTriggerNewItemIndicator(lastIncomingMessage)
          : false;
        const isOwnMessage = !shouldTriggerIndicator; // Inverse of shouldTriggerNewItemIndicator

        if (isOwnMessage) {
          // Only auto-scroll when the user is already at the bottom.
          if (isAtBottom) {
            onOwnMessageSentRef.current?.();
          }
        } else if (!isAtBottom && addedCount > 0) {
          // Someone else's NEW message and we're not at bottom - show indicator
          // Only for added, not updated (reactions, etc)
          onNewMessagesWhileNotAtBottomRef.current();
        }
      }
    }
  }, [incomingMessages, store, isAtBottom, shouldTriggerNewItemIndicator]);

  // Handle updated messages (reactions, edits, deletes)
  // Following 'items-change' pattern from VirtuosoMessageList
  // These don't add new items, just modify existing ones
  useEffect(() => {
    if (updatedMessages.length === 0) return;

    store.updateMultiple(updatedMessages);
    // Pass 0 for addedCount - this is an update, not new messages
    onMessagesUpdatedRef.current([...store.messages], 0);
  }, [updatedMessages, store]);
}
