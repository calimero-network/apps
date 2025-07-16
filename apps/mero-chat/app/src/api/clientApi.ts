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
  links_allowed: boolean;
  read_only: boolean;
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
  limit?: number;
  offset?: number;
  is_dm?: boolean;
  dm_identity?: UserId;
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  reactions: HashMap<string, UserId[]>;
}

export interface MessageWithReactions extends Message {
  reactions: HashMap<string, UserId[]>;
}

export interface SendMessageProps {
  group: Channel;
  message: string;
  timestamp: number;
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
  context_identity: UserId;
  did_join: boolean;
  invitation_payload: string;
}

export interface CreateDmProps {
  user: UserId;
  creator: UserId;
  timestamp: number;
  context_id: string;
  invitation_payload: string;
}

export interface UpdateReactionProps {
  messageId: string;
  emoji: string;
  userId: UserId;
  add: boolean;
}

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
  UPDATE_REACTION = "update_reaction"
}

export interface ClientApi {
  joinChat(): ApiResponse<string>;
  createChannel(props: CreateChannelProps): ApiResponse<CreateChannelResponse>;
  getChannels(): ApiResponse<Channels>;
  getAllChannelsSearch(): ApiResponse<Channels>;
  getChannelMembers(props: GetChannelMembersProps): ApiResponse<UserId[]>;
  getChannelInfo(props: GetChannelInfoProps): ApiResponse<ChannelInfo>;
  inviteToChannel(props: InviteToChannelProps): ApiResponse<string>;
  getNonMemberUsers(props: GetNonMemberUsersProps): ApiResponse<UserId[]>;
  joinChannel(props: JoinChannelProps): ApiResponse<string>;
  leaveChannel(props: LeaveChannelProps): ApiResponse<string>;
  getMessages(props: GetMessagesProps): ApiResponse<FullMessageResponse>;
  sendMessage(props: SendMessageProps): ApiResponse<Message>;
  getDms(): ApiResponse<DMChatInfo[]>;
  getChatMembers(): ApiResponse<UserId[]>;
  createDm(props: CreateDmProps): ApiResponse<string>;
  updateReaction(props: UpdateReactionProps): ApiResponse<string>;
}
