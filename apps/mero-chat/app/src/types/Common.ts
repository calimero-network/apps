export type ChatType = "channel" | "dm";

export type ActiveChat = {
  type: ChatType;
  id: string;
  name: string;
};

export interface User {
  id: string;
  name?: string;
  moderator?: boolean;
  active?: boolean;
}

export interface ChannelMeta {
  name: string;
  description: string;
  members: string[];
  createdAt: string;
  createdBy: string;
  owner: string;
  inviteOnly: boolean;
}