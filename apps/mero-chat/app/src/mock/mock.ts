import type { ActiveChat, User } from "../types/Common";

export const mockDMActiveChat: ActiveChat = {
  type: "direct_message",
  id: "1",
  name: "John Doe",
  account: "0x1234567890",
};

export const mockChannelActiveChat: ActiveChat = {
  type: "channel",
  id: "1",
  name: "Channel 1",
};


export const mockChannelUsers: User[] = [
  {
    id: "1",
    name: "Fran",
    moderator: true,
    active: true,
  },
  {
    id: "2",
    name: "John",
    moderator: false,
    active: true,
  },
  {
    id: "3",
    name: "Jane",
    moderator: false,
    active: false,
  },
];