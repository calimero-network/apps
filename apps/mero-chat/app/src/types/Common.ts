// Import types from virtualized-chat for use throughout this file
import type {
  CurbMessage,
  CurbFile,
  AccountData,
  Option,
  HashMap,
} from "../components/virtualized-chat";
import { MessageStatus } from "../components/virtualized-chat";

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
  username?: string;
  canJoin?: boolean;
  invitationPayload?: string;
  otherIdentityNew?: string;
  creator?: string;
  isSynced?: boolean;
  isFinal?: boolean;
  channelType?: string;
  ownIdentity?: string;
  ownUsername?: string;
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
  createdByUsername: string;
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

export interface AttachmentResponse {
  name: string;
  mime_type: string;
  size: number;
  blob_id: string;
  uploaded_at: number;
}

export interface MessageWithReactions {
  id: string;
  text: string;
  nonce: string;
  timestamp: number;
  sender: string;
  reactions: Map<string, string[]>;
  edited_on?: number;
  files: AttachmentResponse[];
  images: AttachmentResponse[];
  thread_count: number;
  thread_last_timestamp: number;
}

export interface Thread {
  messages: MessageWithReactions[];
}

export interface FileObject {
  blobId: string;
  name: string;
  size: number;
  type: string;
  uploadedAt?: number;
}

export interface ChatFile {
  file: FileObject;
  previewUrl?: string;
}

export interface AttachmentDraft {
  blobId: string;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  uploadedAt?: number;
}

export interface SendMessagePayload {
  text: string;
  files: AttachmentDraft[];
  images: AttachmentDraft[];
}

// Re-export types from virtualized-chat to maintain backwards compatibility
export type { CurbMessage, CurbFile, AccountData, Option, HashMap };
// MessageStatus is an enum, so it must be exported as a value, not just a type
export { MessageStatus };

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
  onEditModeRequested: (message: CurbMessage) => void;
  onEditModeCancelled: (message: CurbMessage) => void;
  onMessageUpdated: (message: CurbMessage) => void;
  onDeleteMessageRequested: (message: CurbMessage) => void;
  fetchAccounts: (prefix: string) => void;
  autocompleteAccounts: AccountData[];
  authToken: string | undefined;
  privateIpfsEndpoint: string;
  contextId?: string;
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
