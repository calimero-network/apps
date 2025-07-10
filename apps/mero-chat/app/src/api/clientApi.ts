import type { ApiResponse } from "@calimero-network/calimero-client";

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
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export interface SendMessageProps {
  group: Channel;
  message: string;
  timestamp: number;
}

export interface FullMessageResponse {
  messages: Message[];
  total_count: number;
  start_position: number;
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
}

export interface InviteToChannelProps {
  channel: Channel;
  user: UserId;
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
}
