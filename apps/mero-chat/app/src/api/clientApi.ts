import type { ApiResponse } from "@calimero-network/calimero-client";
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
  created_by_username: string;
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
}

export interface Message {
  id: string;
  sender: string;
  sender_username: string;
  text: string;
  timestamp: number;
  deleted?: boolean;
  edited_on?: number;
  reactions: HashMap<string, UserId[]>;
  thread_count: number;
  thread_last_timestamp: number;
  group?: string;
}

export interface MessageWithReactions extends Message {
  reactions: HashMap<string, UserId[]>;
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
}

export interface UpdateReactionProps {
  messageId: string;
  emoji: string;
  userId: UserId;
  add: boolean;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface DeleteMessageProps {
  group: Channel;
  messageId: string;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface EditMessageProps {
  group: Channel;
  messageId: string;
  newMessage: string;
  timestamp: number;
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

export interface UpdateDmHashProps {
  sender_id: UserId;
  other_user_id: UserId;
  new_hash: string;
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

export enum ClientMethod {
  JOIN_CHAT = "join_chat",
  CREATE_CHANNEL = "create_channel",
  GET_CHANNELS = "get_channels",
  GET_ALL_CHANNELS_SEARCH = "get_all_channels",
  GET_CHANNEL_MEMBERS = "get_channel_members",
  GET_CHANNEL_INFO = "get_channel_info",
  INVITE_TO_CHANNEL = "invite_to_channel",
  GET_INVITE_USERS = "get_non_member_users",
  JOIN_CHANNEL = "join_channel",
  LEAVE_CHANNEL = "leave_channel",
  GET_MESSAGES = "get_messages",
  SEND_MESSAGE = "send_message",
  GET_DMS = "get_dms",
  GET_CHAT_MEMBERS = "get_chat_members",
  CREATE_DM = "create_dm_chat",
  UPDATE_REACTION = "update_reaction",
  DELETE_MESSAGE = "delete_message",
  EDIT_MESSAGE = "edit_message",
  UPDATE_NEW_IDENTITY = "update_new_identity",
  UPDATE_INVITATION_PAYLOAD = "update_invitation_payload",
  ACCEPT_INVITATION = "accept_invitation",
  DELETE_DM = "delete_dm",
  GET_USERNAME = "get_username",
  GET_CHAT_USERNAMES = "get_chat_usernames",
  READ_MESSAGE = "mark_messages_as_read",
  UPDATE_DM_HASH = "update_dm_hashes",
  READ_DM = "mark_dm_as_read",
  GET_DM_UNREAD_COUNT = "get_dm_unread_count",
  GET_TOTAL_DM_UNREAD_COUNT = "get_total_dm_unread_count",
  GET_DM_IDENTITY_BY_CONTEXT = "get_dm_identity_by_context",
  MARK_ALL_DMS_AS_READ = "mark_all_dms_as_read",
}

export interface ClientApi {
  joinChat(props: JoinChatProps): ApiResponse<string>;
  createChannel(props: CreateChannelProps): ApiResponse<CreateChannelResponse>;
  getChannels(): ApiResponse<Channels>;
  getAllChannelsSearch(): ApiResponse<Channels>;
  getChannelMembers(
    props: GetChannelMembersProps,
  ): ApiResponse<Map<string, string>>;
  getChannelInfo(props: GetChannelInfoProps): ApiResponse<ChannelInfo>;
  inviteToChannel(props: InviteToChannelProps): ApiResponse<string>;
  getNonMemberUsers(props: GetNonMemberUsersProps): ApiResponse<UserId[]>;
  joinChannel(props: JoinChannelProps): ApiResponse<string>;
  leaveChannel(props: LeaveChannelProps): ApiResponse<string>;
  getMessages(props: GetMessagesProps): ApiResponse<FullMessageResponse>;
  sendMessage(props: SendMessageProps): ApiResponse<Message>;
  getDms(): ApiResponse<DMChatInfo[]>;
  getChatMembers(props: GetChatMembersProps): ApiResponse<Map<string, string>>;
  createDm(props: CreateDmProps): ApiResponse<string>;
  updateReaction(props: UpdateReactionProps): ApiResponse<string>;
  editMessage(props: EditMessageProps): ApiResponse<Message>;
  deleteMessage(props: DeleteMessageProps): ApiResponse<string>;
  updateNewIdentity(props: UpdateNewIdentityProps): ApiResponse<string>;
  updateInvitationPayload(
    props: UpdateInvitationPayloadProps,
  ): ApiResponse<string>;
  acceptInvitation(props: AcceptInvitationProps): ApiResponse<string>;
  deleteDM(props: DeleteDMProps): ApiResponse<string>;
  readMessage(props: ReadMessageProps): ApiResponse<string>;
  updateDmHash(props: UpdateDmHashProps): ApiResponse<string>;
  readDm(props: ReadDmProps): ApiResponse<string>;
  getUsername(props: GetUsernameProps): ApiResponse<string>;
  getDmIdentityByContext(props: { context_id: string }): ApiResponse<string>;
}
