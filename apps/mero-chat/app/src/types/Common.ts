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
  canJoin?: boolean;
};

export interface User {
  id: string;
  name?: string;
  moderator?: boolean;
  active?: boolean;
  unreadMessages?: {
    count: number;
    mentions: number;
  };
}

export interface ChannelMeta {
  name: string;
  channelType: string;
  description: string;
  members: User[];
  createdAt: string;
  createdBy: string;
  owner: string;
  inviteOnly: boolean;
  unreadMessages: {
    count: number;
    mentions: number;
  };
  isMember: boolean;
  readOnly: boolean;
}

export interface Message {
  timestamp: number;
  sender: string;
  id: string;
  text: string;
  files: FileObject[];
  images: FileObject[];
  nonce: Uint8Array;
  edited_on?: number;
  mentions: Map<string, number>;
}

export interface MessageWithReactions {
  id: string;
  text: string;
  nonce: string;
  timestamp: number;
  sender: string;
  reactions: Map<string, string[]>;
  edited_on?: number;
  files: FileObject[];
  images: FileObject[];
  thread_count: number;
  thread_last_timestamp: number;
}

export interface Thread {
  messages: MessageWithReactions[];
}

export interface FileObject {
  cid: string;
  name: string;
  size: number;
  type: string;
}

export interface ChatFile {
  file: FileObject;
}
