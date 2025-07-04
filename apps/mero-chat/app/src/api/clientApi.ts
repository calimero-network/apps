import type { ApiResponse } from "@calimero-network/calimero-client";

export enum ClientMethod {
  CREATE_CHANNEL = "create_channel",
  GET_CHANNELS = "get_channels",
  GET_CHANNEL_MEMBERS = "get_channel_members",
  GET_MESSAGES = "get_messages",
  SEND_MESSAGE = "send_message",
}

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

export interface GetChannelMembersProps {
  channel: Channel;
}

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
  totalCount: number;
  startPosition: number;
}

export interface GetChannelInfoProps {
  channel: Channel;
}

export interface ClientApi {
  createChannel(props: CreateChannelProps): ApiResponse<CreateChannelResponse>;
  getChannels(): ApiResponse<Channels>;
  getChannelMembers(props: GetChannelMembersProps): ApiResponse<UserId[]>;
  getChannelInfo(props: GetChannelInfoProps): ApiResponse<ChannelInfo>;
  getMessages(props: GetMessagesProps): ApiResponse<FullMessageResponse>;
  sendMessage(props: SendMessageProps): ApiResponse<Message>;
}
