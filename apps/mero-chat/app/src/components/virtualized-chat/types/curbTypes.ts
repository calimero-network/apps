export type U64 = number;
export type MessageId = string;
export type AccountId = string;
export type Vec<T> = Array<T>;
export type Option<T> = T | undefined;
export type HashMap<K extends string | number, V> = { [key in K]: V };
export type CurbString = string;

export interface CurbFile {
  name: Option<CurbString>;
  ipfs_cid: CurbString;
  mime_type?: CurbString;
  size?: U64;
  uploaded_at?: U64;
  preview_url?: CurbString;
}

export enum MessageStatus {
  sending = "sending",
  sent = "sent",
}

export interface CurbMessage {
  /**
   * Absolute position in the channel, or undefined for a message that has no
   * position yet (an optimistic send, before the node assigns one).
   *
   * Carried so a rendered message can be linked to: the permalink anchor is a
   * position, not an id. See `utils/permalink.ts`.
   */
  index?: number;
  id: MessageId; // id can be temporary or permanent
  text: CurbString;
  nonce: CurbString;
  key: string;
  timestamp: U64;
  sender: AccountId;
  reactions: Option<HashMap<CurbString, Vec<AccountId>>>;
  threadCount?: number;
  threadLastTimestamp?: U64;
  editedOn: Option<U64>;
  mentions: Vec<CurbString>;
  files: Vec<CurbFile>;
  images: Vec<CurbFile>;
  temporalId?: U64; // temporalId is optional because it is not present when the message is received
  editMode?: boolean;
  deleted?: boolean;
  status: MessageStatus;
  group?: string; // Channel name where the message was sent
  parentMessageId?: string; // Set for thread replies; identifies the parent channel message
  contextLabel?: string; // Human-readable label of the originating channel/DM (set on search results)
  contextId?: string; // Context ID of the originating channel/DM (set on search results)
}
export interface AccountData {
  id: string;
  active: boolean;
}

export enum ElementPosition {
  TOP = "TOP",
  BOTTOM = "BOTTOM",
}
