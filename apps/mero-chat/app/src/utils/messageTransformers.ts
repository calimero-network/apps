import type { MessageWithReactions } from "../api/clientApi";
import type { CurbMessage } from "../types/Common";
import { MessageStatus } from "../types/Common";

/**
 * Transforms a MessageWithReactions from the API to a CurbMessage for UI display
 */
export function transformMessageToUI(message: MessageWithReactions): CurbMessage {
  return {
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
  };
}

/**
 * Transforms an array of MessageWithReactions to CurbMessages
 */
export function transformMessagesToUI(messages: MessageWithReactions[]): CurbMessage[] {
  return messages.map(transformMessageToUI);
}

/**
 * Filters and transforms new messages that don't already exist in the current message list
 */
export function getNewMessages(
  apiMessages: MessageWithReactions[],
  existingMessages: CurbMessage[]
): CurbMessage[] {
  const existingMessageIds = new Set(existingMessages.map((msg) => msg.id));
  
  return apiMessages
    .filter((message) => !existingMessageIds.has(message.id))
    .map(transformMessageToUI);
}

