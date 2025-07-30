/**
 * Types of chats.
 * @typedef {object} ChatTypes
 * @property {string} CHANNEL - Designates a multi-user chat.
 * @property {string} DIRECT_MESSAGE - Designates a one-to-one chat.
 */
export type ChatType = "channel" | "direct_message";

/**
 * Enum defining the different states of DM setup process
 */
export enum DMSetupState {
  CREATOR_WAITING_FOR_INVITEE_TO_CREATE_IDENTITY = "CREATOR_WAITING_FOR_INVITEE_TO_CREATE_IDENTITY",
  INVITEE_CONTEXT_CREATE_IDENTITY = "INVITEE_CONTEXT_CREATE_IDENTITY",
  INVITEE_WAITING_INVITATION = "INVITEE_WAITING_INVITATION",
  CREATOR_CONTEXT_INVITATION_POPUP = "CREATOR_CONTEXT_INVITATION_POPUP",
  INVITEE_CONTEXT_ACCEPT_POPUP = "INVITEE_CONTEXT_ACCEPT_POPUP",
  SYNC_WAITING = "SYNC_WAITING",
  ACTIVE = "ACTIVE",
}

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
  contextId?: string;
  id: string;
  name: string;
  readOnly?: boolean;
  account?: string;
  canJoin?: boolean;
  invitationPayload?: string;
  otherIdentityNew?: string;
  creator?: string;
  isSynced?: boolean;
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

export interface ChatMessagesData {
  messages: CurbMessage[];
  totalCount: number;
  hasMore: boolean;
}

export interface ChatMessagesDataWithOlder {
  messages: CurbMessage[];
  totalCount: number;
  hasOlder: boolean;
}

export interface ChannelMeta {
  name: string;
  type: ChatType;
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

export enum MessageStatus {
  sending = "sending",
  sent = "sent",
}

export type Option<T> = T | undefined;
export type HashMap<K extends string | number, V> = { [key in K]: V };
export interface CurbFile {
  name: Option<string>;
  ipfs_cid: string;
}

export interface CurbMessage {
  id: string; // id can be temporary or permanent
  text: string;
  nonce: string;
  key: string;
  timestamp: number;
  sender: string;
  reactions: Option<HashMap<string, Array<string>>>;
  threadCount?: number;
  threadLastTimestamp?: number;
  editedOn: Option<number>;
  mentions: Array<string>;
  files: Array<CurbFile>;
  images: Array<CurbFile>;
  temporalId?: number;
  editMode?: boolean;
  deleted?: boolean;
  status: MessageStatus;
}

export interface AccountData {
  id: string;
  active: boolean;
}

export interface MessageRendererProps {
  accountId: string;
  isThread: boolean;
  handleReaction: (message: CurbMessage, reaction: string) => void;
  setThread?: (message: CurbMessage) => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  toggleEmojiSelector: (message: CurbMessage) => void;
  openMobileReactions: string;
  setOpenMobileReactions: (messageId: string) => void;
  editable: (message: CurbMessage) => boolean;
  deleteable: (message: CurbMessage) => boolean;
  onEditModeRequested: (message: CurbMessage, isThread: boolean) => void;
  onEditModeCancelled: (message: CurbMessage) => void;
  onMessageUpdated: (message: CurbMessage) => void;
  onDeleteMessageRequested: (message: CurbMessage) => void;
  fetchAccounts: (prefix: string) => void;
  autocompleteAccounts: AccountData[];
  authToken: string | undefined;
  privateIpfsEndpoint: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = any;

export interface UpdateFunction<T> {
  (currentMessage: T): Partial<T>;
}

export type UpdateDescriptor<T> =
  | { updatedFields: Partial<T> }
  | { updateFunction: UpdateFunction<T> };

export interface UpdatedMessages {
  id: string;
  descriptor: UpdateDescriptor<T>;
}
