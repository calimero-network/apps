import type { ApiResponse } from "./types";
import type { HashMap } from "../types/Common";

export enum ChannelType {
  PUBLIC = "Public",
  PRIVATE = "Private",
  GROUP = "Default",
}

export interface Channel {
  name: string;
}

export type UserId = string;

export interface CreateChannelProps {
  channel: Channel;
  channel_type: ChannelType;
  read_only: boolean;
  moderators: UserId[];
  links_allowed: boolean;
  created_at: number;
}

export type CreateChannelResponse = string;

export interface ChannelInfo {
  channel_type: string;
  created_at: number;
  created_by: string;
  links_allowed: boolean;
  read_only: boolean;
  unread_count: number;
  unread_mentions: number;
}

export type Channels = Map<string, ChannelInfo>;

interface ChannelOperationProps {
  channel: Channel;
}

export type GetChannelMembersProps = ChannelOperationProps;
export type GetChannelInfoProps = ChannelOperationProps;
export type GetNonMemberUsersProps = ChannelOperationProps;
export type JoinChannelProps = ChannelOperationProps;
export type LeaveChannelProps = ChannelOperationProps;

export interface GetMessagesProps {
  group: Channel;
  parent_message?: string;
  limit?: number;
  offset?: number;
  is_dm?: boolean;
  dm_identity?: UserId;
  refetch_context_id?: string;
  refetch_identity?: UserId;
  search_term?: string;
}

/**
 * A window of history addressed from the START of the channel.
 *
 * Distinct from `GetMessagesProps`, which counts back from the end: an offset
 * from the end names a different message every time something is appended, so
 * it cannot be stored and reused. `start` is an absolute position and does not
 * move, which is what lets a client persist where it got to and resume there
 * after being closed.
 */
export interface GetMessagesFromProps {
  group: Channel;
  start: number;
  limit?: number;
  is_dm?: boolean;
  dm_identity?: UserId;
  refetch_context_id?: string;
  refetch_identity?: UserId;
}

export interface GetMessageCountProps {
  group: Channel;
  is_dm?: boolean;
  dm_identity?: UserId;
  refetch_context_id?: string;
  refetch_identity?: UserId;
}

/**
 * One page of `search_messages` in one context. `cursor` is the previous
 * page's `next_cursor`; omit it for the first page.
 */
export interface SearchMessagesProps {
  query: string;
  cursor?: string | null;
  limit?: number;
  contextId: string;
  executorPublicKey: string;
}

/** A message `search_messages` found: enough to list and open it. */
export interface SearchHit {
  id: string;
  /** Set for a thread reply: the top-level message it replies to. */
  parent_message_id?: string | null;
  /**
   * Position of the top-level message (a reply's parent). `null` from the
   * index-backed search, which does not walk the channel: ask
   * `message_position` for it when the hit is opened.
   */
  index: number | null;
  /** Seconds, as the contract stores them. */
  timestamp: number;
  /** What the hit is ranked by: its own timestamp, or its parent's for a reply. */
  anchor_timestamp: number;
  sender: UserId;
  /** Plain text around the first match. */
  snippet: string;
  /** The match inside `snippet`, as JS string indices. */
  match_start: number;
  match_end: number;
}

export interface SearchPage {
  hits: SearchHit[];
  /** `null` once the walk reached the oldest message. */
  next_cursor?: string | null;
  /** Oldest timestamp the call ranked; later pages rank at or below it. */
  frontier_timestamp?: number | null;
}

/** `message_position`: where a top-level message sits in its channel. */
export interface MessagePositionProps {
  messageId: string;
  contextId: string;
  executorPublicKey: string;
}

/**
 * `search_all_messages`: what a context still on an app version older than
 * `search_messages` answers. Used only as that fallback.
 */
export interface SearchAllMessagesProps {
  search_term: string;
  limit?: number;
  offset?: number;
  contextId?: string;
  executorPublicKey?: string;
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  deleted?: boolean;
  edited_on?: number;
  reactions: HashMap<string, UserId[]>;
  thread_count: number;
  thread_last_timestamp: number;
  group?: string;
  files?: AttachmentResponse[];
  images?: AttachmentResponse[];
  parent_message_id?: string;
  /**
   * Accounts this message mentions directly. Sent by the contract on every
   * message and previously untyped here, which is why it was dropped on
   * arrival even though the sender had carefully recorded it.
   */
  mentions?: UserId[];
  /**
   * Display names this message mentions, plus the reserved broadcast words
   * `everyone` / `here` — the contract stores both in one list.
   */
  mentions_usernames?: string[];
}

export interface MessageWithReactions extends Message {
  reactions: HashMap<string, UserId[]>;
  /**
   * Absolute position in the channel, counted from the first message.
   *
   * Stable: appends land after it and a delete keeps its slot, so an index
   * names the same message whenever it is asked for. That is what makes it
   * usable as a persisted cursor — unlike an offset from the end, which shifts
   * every time someone speaks.
   */
  index: number;
}

export interface AttachmentRequest {
  name: string;
  blob_id_str: string;
  mime_type: string;
  size: number;
}

export interface AttachmentResponse {
  name: string;
  blob_id: string;
  mime_type: string;
  size: number;
  uploaded_at: number;
}

export interface SendMessageProps {
  group: Channel;
  message: string;
  mentions: UserId[];
  usernames: string[];
  timestamp: number;
  parent_message?: string;
  is_dm?: boolean;
  dm_identity?: UserId;
  files?: AttachmentRequest[];
  images?: AttachmentRequest[];
}

export interface FullMessageResponse {
  messages: MessageWithReactions[];
  total_count: number;
  start_position: number;
}

export interface InviteToChannelProps {
  channel: Channel;
  user: UserId;
}

export interface DMChatInfo {
  channel_type: ChannelType;
  created_at: number;
  created_by: UserId;
  channel_user: UserId;
  context_id: string;
  other_identity_new: UserId;
  other_identity_old: UserId;
  other_username: string;
  own_identity: UserId;
  own_identity_old: UserId;
  own_username: string;
  did_join: boolean;
  invitation_payload: string;
  old_hash: string;
  new_hash: string;
  unread_messages: number;
}

export interface CreateDmProps {
  context_id: string;
  context_hash: string;
  creator: UserId;
  creator_new_identity: UserId;
  invitee: UserId;
  timestamp: number;
  payload: string;
}

export interface UpdateReactionProps {
  messageId: string;
  emoji: string;
  add: boolean;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface DeleteMessageProps {
  group: Channel;
  messageId: string;
  parent_id?: string;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface EditMessageProps {
  group: Channel;
  messageId: string;
  newMessage: string;
  timestamp: number;
  parent_id?: string;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface UpdateNewIdentityProps {
  other_user: UserId;
  new_identity: UserId;
}

export interface UpdateInvitationPayloadProps {
  other_user: UserId;
  invitation_payload: string;
}

export interface AcceptInvitationProps {
  other_user: UserId;
}

export interface GetChatMembersProps {
  isDM?: boolean;
  executor?: UserId;
}

export interface JoinChatProps {
  isDM?: boolean;
  contextId?: string;
  executor?: UserId;
  username?: string;
  executorPublicKey?: string;
}

export interface DeleteDMProps {
  other_user: UserId;
}

export interface ReadMessageProps {
  channel: Channel;
  timestamp: number;
}

export interface MarkAsReadProps {
  contextId: string;
  executorPublicKey: string;
  timestamp: number;
}

export interface GetUnreadProps {
  contextId: string;
  executorPublicKey: string;
}

export interface ReadDmProps {
  other_user_id: UserId;
}

export interface GetDmUnreadCountProps {
  other_user_id: UserId;
}

export interface GetUsernameProps {
  userId: UserId;
  executorPublicKey?: string;
  contextId?: string;
}

export type GetTotalDmUnreadCountProps = Record<string, never>;

export type MarkAllDmsAsReadProps = Record<string, never>;

export type Role = "User" | "Mod" | "Admin" | "Banned";

export interface SetMemberRoleProps {
  contextId: string;
  /// The actor's identity for this context (must be Admin or Mod).
  executorPublicKey: string;
  /// The member whose role is being changed.
  target: string;
  role: Role;
}

export interface GetMemberRoleProps {
  contextId: string;
  executorPublicKey: string;
  identity: string;
}

export interface ListRolesProps {
  contextId: string;
  executorPublicKey: string;
}

/// Returned by `list_roles` — only members with a non-default role appear.
export interface MemberRoleEntry {
  identity: string;
  role: Role;
}

/** What the message cache (`repositories/messages`) reads through. */
export interface ClientApi {
  getMessagesFrom(props: GetMessagesFromProps): ApiResponse<FullMessageResponse>;
  getMessageCount(props: GetMessageCountProps): ApiResponse<number>;
}
