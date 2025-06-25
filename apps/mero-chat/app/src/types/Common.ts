/**
 * Types of chats.
 * @typedef {object} ChatTypes
 * @property {string} CHANNEL - Designates a multi-user chat.
 * @property {string} DIRECT_MESSAGE - Designates a one-to-one chat.
 */
export type ChatType = "channel" | "direct_message";

/**
 * Initial version of the chat object, currently only supports channels and p2p DMs.
 * @typedef {object} Chat
 * @property {string} type - Can be 'channel' or 'direct_message'.
 * @property {string} [name] - Name of the channel.
 * @property {string} [account] - Account for direct message.
 * @property {boolean} [readOnly] - Whether the chat is read-only.
 */
export type ActiveChat = {
  type: ChatType;
  id: string;
  name: string;
  readOnly?: boolean;
  account?: string;
};

export interface User {
  id: string;
  name?: string;
  moderator?: boolean;
  active?: boolean;
}

export interface ChannelMeta {
  name: string;
  description: string;
  members: User[];
  createdAt: string;
  createdBy: string;
  owner: string;
  inviteOnly: boolean;
}