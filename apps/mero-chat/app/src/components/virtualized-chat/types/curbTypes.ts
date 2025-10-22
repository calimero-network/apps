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
}

export enum MessageStatus {
  sending = "sending",
  sent = "sent",
}

export interface CurbMessage {
  id: MessageId; // id can be temporary or permanent
  text: CurbString;
  nonce: CurbString;
  key: string;
  timestamp: U64;
  senderUsername?: CurbString; // Optional to match our usage
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
}
export interface AccountData {
  id: string;
  active: boolean;
}

export enum ElementPosition {
  TOP = "TOP",
  BOTTOM = "BOTTOM",
}
